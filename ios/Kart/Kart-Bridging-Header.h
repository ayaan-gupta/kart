//
// Use this file to import your target's public headers that you would like to expose to Swift.
//

// Exposes RCTPromiseResolveBlock/RCTPromiseRejectBlock to Swift, for the debug-only
// KartFrameLab.swift bridge module (see that file). Importing this header is harmless in every
// build configuration; only KartFrameLab.swift's own use of these types is DEBUG-guarded.
#import <React/RCTBridgeModule.h>
