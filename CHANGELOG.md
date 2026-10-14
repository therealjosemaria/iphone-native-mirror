# Changelog

## 0.0.10 — 2026-10-14

First public release of the native macOS Screen Mirroring bridge for the
OpenDisplay iPhone receiver.

- Install once with npm; a user LaunchAgent runs the receiver at login.
- Select iPhone in the native macOS Screen Mirroring menu.
- Portrait extended desktop, advertised at 1288 × 2796 and up to 60 FPS.
- Phone readiness check before AirPlay display setup.
- Fast rejection after two explicit connection refusals, with a 500 ms retry.
- Explicitly release pending native approval during shutdown.
- One macOS error for a closed phone app; a centered native dialog for playback failure.
- Conditional Tailscale setup and login handling.

Verified on one Apple Silicon Mac and iPhone 14 Pro Max. The user confirmed
portrait display, normal disconnect, and faster single-error behavior.
Twenty automated tests cover framing, video startup, readiness, native RTSP,
session lifecycle, installer configuration and Tailscale behavior.

Limits: iPhone OpenDisplay must remain visible; no audio, touch input, automatic
route selection, USB or direct peer-to-peer Wi-Fi. The picker uses a TV icon
because the tested MacBook discovery identity prevented AirPlay negotiation.
