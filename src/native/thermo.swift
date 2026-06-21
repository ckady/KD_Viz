// thermo — streams Apple Silicon die temperature + fan RPM as JSON lines.
//
// Die temps: IOKit IOHIDEventSystemClient thermal sensors (powermetrics doesn't
// expose them on Apple Silicon).
// Fan RPM: AppleSMC via IOKit. The 80-byte SMCParamStruct layout (note the
// `padding` field — without it the kernel returns kIOReturnBadArgument on Apple
// Silicon) follows the public MIT approach from agoodkind/macos-smc-fan, via
// ProducerGuy/ThermalForge. Read-only; no sudo required.
//
// Usage: `thermo [intervalMs]`.
import Foundation
import IOKit

// ---------------- Thermal sensors (temperature) ----------------

typealias IOHIDEventSystemClientRef = UnsafeMutableRawPointer
typealias IOHIDServiceClientRef = UnsafeMutableRawPointer
typealias IOHIDEventRef = UnsafeMutableRawPointer

let kIOHIDEventTypeTemperature: Int64 = 15
let kIOHIDEventFieldTemperatureLevel: Int32 = Int32(15 << 16)

@_silgen_name("IOHIDEventSystemClientCreate")
func IOHIDEventSystemClientCreate(_ allocator: CFAllocator?) -> IOHIDEventSystemClientRef?
@_silgen_name("IOHIDEventSystemClientSetMatching")
func IOHIDEventSystemClientSetMatching(_ client: IOHIDEventSystemClientRef?, _ matching: CFDictionary?)
@_silgen_name("IOHIDEventSystemClientCopyServices")
func IOHIDEventSystemClientCopyServices(_ client: IOHIDEventSystemClientRef?) -> CFArray?
@_silgen_name("IOHIDServiceClientCopyProperty")
func IOHIDServiceClientCopyProperty(_ service: IOHIDServiceClientRef?, _ key: CFString) -> CFTypeRef?
@_silgen_name("IOHIDServiceClientCopyEvent")
func IOHIDServiceClientCopyEvent(_ service: IOHIDServiceClientRef?, _ type: Int64, _ options: Int32, _ timeout: Int64) -> IOHIDEventRef?
@_silgen_name("IOHIDEventGetFloatValue")
func IOHIDEventGetFloatValue(_ event: IOHIDEventRef?, _ field: Int32) -> Double

func readSensors(_ client: IOHIDEventSystemClientRef) -> [(String, Double)] {
    guard let servicesCF = IOHIDEventSystemClientCopyServices(client) else { return [] }
    let count = CFArrayGetCount(servicesCF)
    var out: [(String, Double)] = []
    for i in 0..<count {
        guard let raw = CFArrayGetValueAtIndex(servicesCF, i) else { continue }
        let service = UnsafeMutableRawPointer(mutating: raw)
        guard let nameRef = IOHIDServiceClientCopyProperty(service, "Product" as CFString),
              let name = nameRef as? String else { continue }
        guard let ev = IOHIDServiceClientCopyEvent(service, kIOHIDEventTypeTemperature, 0, 0) else { continue }
        let t = IOHIDEventGetFloatValue(ev, kIOHIDEventFieldTemperatureLevel)
        if t > 0 && t < 130 { out.append((name, t)) }
    }
    return out
}

// ---------------- AppleSMC (fan RPM) ----------------

struct SMCParam {
    struct Version { var major: UInt8 = 0; var minor: UInt8 = 0; var build: UInt8 = 0; var reserved: UInt8 = 0; var release: UInt16 = 0 }
    struct PLimit { var version: UInt16 = 0; var length: UInt16 = 0; var cpuPLimit: UInt32 = 0; var gpuPLimit: UInt32 = 0; var memPLimit: UInt32 = 0 }
    struct KeyInfo { var dataSize: UInt32 = 0; var dataType: UInt32 = 0; var dataAttributes: UInt8 = 0 }
    var key: UInt32 = 0
    var vers = Version()
    var pLimit = PLimit()
    var keyInfo = KeyInfo()
    var padding: UInt16 = 0   // REQUIRED — makes the struct the 80 bytes the kernel expects
    var result: UInt8 = 0
    var status: UInt8 = 0
    var data8: UInt8 = 0
    var data32: UInt32 = 0
    var bytes: (UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,
                UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8,UInt8) =
               (0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)
}

func fourCC(_ s: String) -> UInt32 { s.utf8.reduce(0) { ($0 << 8) | UInt32($1) } }

final class SMC {
    private var conn: io_connect_t = 0
    init?() {
        var it: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleSMC"), &it) == kIOReturnSuccess else { return nil }
        let svc = IOIteratorNext(it); IOObjectRelease(it)
        guard svc != 0 else { return nil }
        defer { IOObjectRelease(svc) }
        guard IOServiceOpen(svc, mach_task_self_, 0, &conn) == kIOReturnSuccess else { return nil }
    }
    deinit { IOServiceClose(conn) }

    private func call(_ i: inout SMCParam, _ o: inout SMCParam) -> kern_return_t {
        var os = MemoryLayout<SMCParam>.stride
        return IOConnectCallStructMethod(conn, 2, &i, MemoryLayout<SMCParam>.stride, &o, &os)
    }
    func readFloat(_ key: String) -> Float? {
        var i = SMCParam(), o = SMCParam()
        i.key = fourCC(key); i.data8 = 9 // key info
        guard call(&i, &o) == kIOReturnSuccess, o.keyInfo.dataSize >= 4 else { return nil }
        i.keyInfo.dataSize = o.keyInfo.dataSize; i.data8 = 5 // read bytes
        guard call(&i, &o) == kIOReturnSuccess else { return nil }
        var v: Float = 0
        withUnsafeBytes(of: o.bytes) { _ = memcpy(&v, $0.baseAddress, 4) }
        return v
    }
    func readU8(_ key: String) -> Int? {
        var i = SMCParam(), o = SMCParam()
        i.key = fourCC(key); i.data8 = 9
        guard call(&i, &o) == kIOReturnSuccess, o.keyInfo.dataSize >= 1 else { return nil }
        i.keyInfo.dataSize = o.keyInfo.dataSize; i.data8 = 5
        guard call(&i, &o) == kIOReturnSuccess else { return nil }
        return withUnsafeBytes(of: o.bytes) { Int($0[0]) }
    }
}

// ---------------- Main loop ----------------

let intervalMs = CommandLine.arguments.count > 1 ? (Double(CommandLine.arguments[1]) ?? 1000) : 1000
let matching: [String: Any] = ["PrimaryUsagePage": 0xff00, "PrimaryUsage": 5]

guard let client = IOHIDEventSystemClientCreate(kCFAllocatorDefault) else {
    FileHandle.standardError.write("thermo: could not create IOHID client\n".data(using: .utf8)!)
    exit(1)
}
IOHIDEventSystemClientSetMatching(client, matching as CFDictionary)

let smc = SMC()
let fanCount = smc?.readU8("FNum") ?? 0
let fanMax = (fanCount > 0 ? smc?.readFloat("F0Mx") : nil) ?? 0
let fanMin = (fanCount > 0 ? smc?.readFloat("F0Mn") : nil) ?? 0

while true {
    let sensors = readSensors(client)
    let dies = sensors.filter { $0.0.lowercased().contains("tdie") }.map { $0.1 }
    let pool = dies.isEmpty ? sensors.map { $0.1 } : dies
    var fields: [String] = []
    if !pool.isEmpty {
        fields.append(String(format: "\"tempC\":%.2f", pool.max() ?? 0))
        fields.append(String(format: "\"tempAvg\":%.2f", pool.reduce(0, +) / Double(pool.count)))
        fields.append("\"n\":\(sensors.count)")
    }
    if fanCount > 0, let rpm = smc?.readFloat("F0Ac") {
        fields.append(String(format: "\"fanRpm\":%.0f", rpm))
        if fanMax > 0 { fields.append(String(format: "\"fanMax\":%.0f", fanMax)) }
        if fanMin > 0 { fields.append(String(format: "\"fanMin\":%.0f", fanMin)) }
    }
    if !fields.isEmpty {
        print("{" + fields.joined(separator: ",") + "}")
        fflush(stdout)
    }
    Thread.sleep(forTimeInterval: intervalMs / 1000.0)
}
