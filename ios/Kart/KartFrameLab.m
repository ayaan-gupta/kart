// ios/Kart/KartFrameLab.m
//
// Objective-C bridge declaration for the debug-only KartFrameLab.swift. See that file for what
// it does and why it is guarded the same way here: `RCT_EXTERN_MODULE` declares a category on a
// class named "KartFrameLab", and if that class did not exist in a Release build (it does not,
// see KartFrameLab.swift's own #if DEBUG), a category on a missing class would fail to link.
#if DEBUG
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(KartFrameLab, NSObject)

RCT_EXTERN_METHOD(scanBundledImage:(NSString *)path
                  request:(NSDictionary *)request
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
#endif
