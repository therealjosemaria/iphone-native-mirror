// Read-only runtime diagnostic for macOS output-device discovery.
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#import <objc/message.h>

@interface NSObject (MirrorDiagnostics)
- (id)initWithDeviceFeatures:(NSUInteger)features;
- (void)setDiscoveryMode:(NSInteger)mode;
- (NSArray *)availableOutputDevices;
- (NSString *)name;
- (NSUInteger)deviceFeatures;
- (BOOL)isLocalAirPlayDevice;
- (NSString *)modelID;
@end

int main(int argc, char **argv) {
    @autoreleasepool {
        dlopen("/System/Library/Frameworks/AVFoundation.framework/AVFoundation", RTLD_NOW);
        dlopen("/System/Library/Frameworks/AVKit.framework/AVKit", RTLD_NOW);
        dlopen("/System/Library/PrivateFrameworks/AirPlaySender.framework/AirPlaySender", RTLD_NOW);
        if (argc > 1 && !strcmp(argv[1], "--discover")) {
            [NSApplication sharedApplication];
            [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
            [NSApp finishLaunching];
            Class cls = NSClassFromString(@"AVOutputDeviceDiscoverySession");
            if (!cls) return 1;
            NSMutableArray *sessions = [NSMutableArray array];
            for (NSNumber *features in @[@1, @2, @4]) {
                id session = [[cls alloc] initWithDeviceFeatures:features.unsignedIntegerValue];
                if (!session) { fprintf(stderr, "Discovery factory unavailable for features=%lu\n", features.unsignedLongValue); return 2; }
                [session setDiscoveryMode:2];
                [sessions addObject:session];
            }
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:12]];
            int index = 0;
            for (id session in sessions) {
                NSArray *devices = [session availableOutputDevices];
                printf("DISCOVERY filter=%s count=%lu\n", [@[@"audio", @"screen", @"video", @"all"] [index++] UTF8String], (unsigned long)devices.count);
                for (id device in devices) if ([[device name] containsString:@"iPhone"])
                    printf("TARGET %s features=%lu local=%d model=%s\n", [[device name] UTF8String], (unsigned long)[device deviceFeatures], [device isLocalAirPlayDevice], [[device modelID] UTF8String]);
                [session setDiscoveryMode:0];
            }
            return 0;
        }
        NSArray *names = @[@"AVOutputDeviceDiscoverySession", @"AVFigRouteDiscovererOutputDeviceDiscoverySessionImpl", @"AVFigRoutingContextOutputContextImpl", @"AVOutputDevice", @"AVOutputContext"];
        int found = 0;
        for (NSString *name in names) {
            Class cls = NSClassFromString(name);
            if (!cls) continue;
            found++;
            printf("CLASS %s\n", name.UTF8String);
            for (int meta = 0; meta < 2; meta++) {
                unsigned int count = 0;
                Method *methods = class_copyMethodList(meta ? object_getClass(cls) : cls, &count);
                for (unsigned int i = 0; i < count; i++)
                    printf("%c %s %s\n", meta ? '+' : '-', sel_getName(method_getName(methods[i])), method_getTypeEncoding(methods[i]));
                free(methods);
            }
        }
        return found >= 3 ? 0 : 1;
    }
}
