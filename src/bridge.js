import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Decoder, frame } from './protocol.js';
import { VideoGate } from './video.js';
import { ReadinessGuard } from './readiness.js';
import { prepareTailscale } from './tailscale.js';

const host = process.env.IPHONE_HOST;
if (!host) throw new Error('Set IPHONE_HOST to the iPhone LAN or Tailscale address');
const binary = process.env.AIRPLAY_BINARY || fileURLToPath(new URL('../build/airplay-bridge', import.meta.url));
const errorBinary = process.env.MIRROR_ERROR_BINARY || fileURLToPath(new URL('../build/iphone-display-error', import.meta.url));
const readiness = new ReadinessGuard(() => failSession('No iPhone playback confirmation'), {
  timeoutMs: Number(process.env.MIRROR_READY_TIMEOUT_MS || 10000),
});
const receiverReadiness = new ReadinessGuard(() => failSession('iPhone receiver did not answer'), {
  timeoutMs: Number(process.env.MIRROR_HELLO_TIMEOUT_MS || 3000),
});
let stopping = false, active = false, socket, retry, heartbeat, ready = false, generation = 0, preflightPending = false;
let preflightRefusals = 0;
const receiver = spawn(binary, [process.env.MIRROR_NAME || 'iPhone Mirror'], {
  stdio: ['ignore', 'pipe', 'inherit', 'pipe', 'pipe'], env: { ...process.env, MIRROR_EVENTS: '1' },
});
const sessionDecoder = new Decoder(body => {
  const message = JSON.parse(body.toString());
  if (message.preflight === true) {
    preflightPending = true;
    if (ready) { approvePreflight(); return; }
  }
  if ((message.active === true || message.preflight === true) && !active) {
    active = true;
    const session = ++generation;
    prepareTailscale(host).then(state => {
      if (!active || stopping || session !== generation) return;
      if (state === 'missing' || state === 'unconfigured') return failSession('Tailscale setup required', 'tailscale');
      if (state === 'login') return failSession('Tailscale login opened', 'login');
      receiverReadiness.start();
      connect();
    }).catch(() => { if (session === generation) failSession('Tailscale setup required', 'tailscale'); });
  } else if (message.active === false && active) {
    active = false;
    generation++;
    readiness.stop();
    receiverReadiness.stop();
    disconnectPhone();
    console.error('IPHONE-SESSION ended with AirPlay');
  }
});
receiver.stdio[4].on('error', error => { if (!stopping) console.error('AIRPLAY-APPROVAL:', error.message); });
function approvePreflight() {
  if (!preflightPending) return;
  preflightPending = false;
  receiver.stdio[4].write(Buffer.from([1]));
  console.error('AIRPLAY-PREFLIGHT approved');
}
receiver.stdio[3].on('data', bytes => {
  try { sessionDecoder.push(bytes); }
  catch (error) { console.error('AIRPLAY-EVENT:', error.message); stop(); process.exitCode = 1; }
});
const gate = new VideoGate();
let pendingVideo = [], pendingBytes = 0;
const videoDecoder = new Decoder(body => {
  if (!active) return;
  const accepted = gate.accept(body);
  if (!accepted) return;
  const packet = frame(accepted);
  if (!ready || !socket || socket.destroyed) {
    pendingBytes += packet.length;
    if (pendingBytes > 4 * 1024 * 1024) {
      pendingVideo = []; pendingBytes = 0; gate.reset();
    } else pendingVideo.push(packet);
  } else if (!socket.write(packet)) receiver.stdout.pause();
}, 16 * 1024 * 1024);
receiver.stdout.on('data', bytes => {
  try { videoDecoder.push(bytes); }
  catch (error) { console.error('AIRPLAY-VIDEO:', error.message); stop(); process.exitCode = 1; }
});
receiver.on('error', error => { console.error('AIRPLAY:', error.message); stop(); process.exitCode = 1; });
receiver.on('exit', (code, signal) => {
  console.error('AIRPLAY-EXIT', code, signal);
  if (!stopping) { stop(); process.exitCode = 1; }
});
function connect() {
  if (!active || stopping) return;
  ready = false;
  let handshaken = false;
  const connection = net.createConnection({ host, port: Number(process.env.IPHONE_PORT || 9000) });
  socket = connection;
  connection.setNoDelay(true);
  connection.on('drain', () => receiver.stdout.resume());
  connection.setTimeout(8000, () => connection.destroy(new Error('iPhone silent')));
  const decoder = new Decoder(payload => {
    const message = JSON.parse(payload.toString());
    if (message.type === 'hello' && !ready) {
      if ((message.pv ?? 1) > 3) throw new Error('Unsupported receiver protocol');
      ready = true;
      handshaken = true;
      receiverReadiness.stop();
      readiness.start();
      console.error('IPHONE-READY', message.name || host);
      console.error('IPHONE-PANEL', JSON.stringify(message.panel || { width: message.pixelsWide, height: message.pixelsHigh, scale: message.scale }));
      connection.write(frame({ type: 'welcome', pv: 3, min: 1 }));
      for (const packet of pendingVideo) {
        if (!connection.write(packet)) receiver.stdout.pause();
      }
      pendingVideo = []; pendingBytes = 0;
      heartbeat = setInterval(() => connection.write(frame({ type: 'ping', t: Date.now() })), 2000);
      approvePreflight();
    } else if (message.type === 'ping') {
      connection.write(frame({ type: 'pong', t: message.t, mt: Date.now() }));
    } else if (message.type === 'stats') {
      readiness.observe(message);
      console.error('PHONE-STATS', JSON.stringify(message));
    }
    else if (message.type === 'kf') { gate.reset(); console.error('PHONE-KF: awaiting next AirPlay IDR'); }
    else if (message.type === 'closing' || message.type === 'sleeping') failSession('iPhone receiver closed or locked');
  });
  connection.on('data', data => {
    if (socket !== connection) return;
    try { decoder.push(data); } catch (error) { connection.destroy(error); }
  });
  connection.on('error', error => {
    console.error('IPHONE:', error.message);
    if (socket === connection && preflightPending && error.code === 'ECONNREFUSED' && ++preflightRefusals >= 2)
      failSession('iPhone receiver refused the connection');
  });
  connection.on('close', () => {
    if (socket !== connection) return;
    socket = undefined;
    ready = false;
    gate.reset(); pendingVideo = []; pendingBytes = 0;
    clearInterval(heartbeat);
    readiness.stop();
    if (handshaken && active && !stopping) receiverReadiness.start();
    receiver.stdout.resume();
    if (!stopping && active) retry = setTimeout(connect, 500);
  });
}
function disconnectPhone() {
  clearTimeout(retry); clearInterval(heartbeat);
  ready = false; gate.reset();
  preflightRefusals = 0;
  preflightPending = false;
  pendingVideo = []; pendingBytes = 0;
  const previous = socket; socket = undefined;
  previous?.destroy();
  receiver.stdout.resume();
}
function stop() {
  stopping = true; active = false;
  generation++;
  readiness.stop();
  receiverReadiness.stop();
  const rejectPreflight = preflightPending;
  disconnectPhone();
  // Wake the native approval wait before shutdown joins its request thread.
  if (rejectPreflight && !receiver.stdio[4].destroyed)
    receiver.stdio[4].write(Buffer.from([0]), () => receiver.kill());
  else receiver.kill();
}
function failSession(reason, kind = 'opendisplay') {
  if (!active || stopping) return;
  console.error('IPHONE-NOT-READY:', reason);
  const systemHandlesError = preflightPending && kind === 'opendisplay';
  if (systemHandlesError) console.error('IPHONE-ERROR: macOS handles rejected connection; skipping duplicate dialog');
  // Do not place the error on the AirPlay display while it is being removed.
  receiver.once('exit', () => {
    if (kind === 'login' || systemHandlesError) return;
    const dialog = spawn(errorBinary, [kind], { detached: true, stdio: 'ignore' });
    dialog.on('error', error => console.error('ERROR-DIALOG:', error.message));
    dialog.unref();
  });
  stop();
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
