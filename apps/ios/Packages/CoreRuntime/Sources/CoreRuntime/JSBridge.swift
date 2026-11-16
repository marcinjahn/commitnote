import Foundation
import JavaScriptCore

/// Its message becomes the JavaScript error message, so it must never carry note contents, names or paths.
struct HostCallError: Error {
    let message: String

    init(_ message: String) {
        self.message = message
    }
}

struct Deferred {
    let promise: JSValue
    let resolve: JSValue
    let reject: JSValue
}

enum JSBridge {
    static func uint8Array(_ data: Data, in context: JSContext) throws -> JSValue {
        let ctx = context.jsGlobalContextRef
        var exception: JSValueRef?
        guard let object = JSObjectMakeTypedArray(ctx, kJSTypedArrayTypeUint8Array, data.count, &exception),
            exception == nil
        else {
            throw HostCallError("Could not allocate a Uint8Array")
        }
        if !data.isEmpty {
            guard let pointer = JSObjectGetTypedArrayBytesPtr(ctx, object, &exception), exception == nil else {
                throw HostCallError("Could not allocate a Uint8Array")
            }
            _ = data.copyBytes(to: UnsafeMutableRawBufferPointer(start: pointer, count: data.count))
        }
        return JSValue(jsValueRef: object, in: context)
    }

    static func data(_ value: JSValue?) throws -> Data {
        guard let value, let context = value.context else { throw HostCallError("Expected a Uint8Array") }
        let ctx = context.jsGlobalContextRef
        let ref = value.jsValueRef
        var exception: JSValueRef?
        guard JSValueGetTypedArrayType(ctx, ref, &exception) == kJSTypedArrayTypeUint8Array,
            exception == nil,
            let object = JSValueToObject(ctx, ref, &exception)
        else {
            throw HostCallError("Expected a Uint8Array")
        }
        let length = JSObjectGetTypedArrayByteLength(ctx, object, &exception)
        if length == 0 { return Data() }
        let offset = JSObjectGetTypedArrayByteOffset(ctx, object, &exception)
        guard let base = JSObjectGetTypedArrayBytesPtr(ctx, object, &exception), exception == nil else {
            throw HostCallError("Expected a Uint8Array")
        }
        return Data(bytes: base.advanced(by: offset), count: length)
    }

    static func string(_ value: JSValue?) throws -> String {
        guard let value, value.isString, let string = value.toString() else {
            throw HostCallError("Expected a string")
        }
        return string
    }

    static func integer(_ value: JSValue?, in range: ClosedRange<Int>) throws -> Int {
        guard let value, value.isNumber else { throw HostCallError("Expected an integer") }
        let number = value.toDouble()
        guard number.isFinite, number.rounded() == number,
            number >= Double(range.lowerBound), number <= Double(range.upperBound)
        else {
            throw HostCallError("Integer out of range")
        }
        return Int(number)
    }

    static func number(_ value: JSValue?) throws -> Double {
        guard let value, value.isNumber else { throw HostCallError("Expected a number") }
        let number = value.toDouble()
        guard number.isFinite else { throw HostCallError("Expected a finite number") }
        return number
    }

    static func bool(_ value: JSValue?) throws -> Bool {
        guard let value, value.isBoolean else { throw HostCallError("Expected a boolean") }
        return value.toBool()
    }

    static func object(_ value: JSValue?) throws -> JSValue {
        guard let value, value.isObject, !value.isNull else { throw HostCallError("Expected an object") }
        return value
    }

    static func newObject(in context: JSContext, _ properties: [(String, Any)] = []) -> JSValue {
        let object: JSValue = JSValue(newObjectIn: context)
        for (name, value) in properties {
            object.setValue(value, forProperty: name)
        }
        return object
    }

    static func newArray(in context: JSContext, _ elements: [JSValue]) -> JSValue {
        let array: JSValue = JSValue(newArrayIn: context)
        for (index, element) in elements.enumerated() {
            array.setValue(element, at: index)
        }
        return array
    }

    /// The executor runs synchronously, so resolve and reject are captured before this returns.
    static func deferred(in context: JSContext) throws -> Deferred {
        var resolve: JSValue?
        var reject: JSValue?
        let promise = JSValue(newPromiseIn: context) { resolveFunction, rejectFunction in
            resolve = resolveFunction
            reject = rejectFunction
        }
        guard let promise, let resolve, let reject else { throw HostCallError("Could not create a promise") }
        return Deferred(promise: promise, resolve: resolve, reject: reject)
    }

    static func error(_ message: String, in context: JSContext) -> JSValue {
        JSValue(newErrorFromMessage: message, in: context)
    }
}
