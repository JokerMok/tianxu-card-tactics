import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

struct RunnerError: Error, CustomStringConvertible {
    let description: String
}

func diagnostic(_ message: String) {
    let data = Data(("T203 native runner: \(message)\n").utf8)
    FileHandle.standardError.write(data)
}

func stringValue(_ value: Any?, _ label: String) throws -> String {
    guard let value = value as? String, !value.isEmpty else {
        throw RunnerError(description: "\(label) is missing")
    }
    return value
}

func dictionaryValue(_ value: Any?, _ label: String) throws -> [String: Any] {
    guard let value = value as? [String: Any] else {
        throw RunnerError(description: "\(label) is missing")
    }
    return value
}

func integerValue(_ value: Any?, _ label: String) throws -> Int {
    guard let value = value as? Int else {
        throw RunnerError(description: "\(label) is missing")
    }
    return value
}

func jsonObject(_ value: Any?, _ label: String) throws -> Any {
    guard let value else {
        throw RunnerError(description: "\(label) is missing")
    }
    return value
}

func runProcess(_ executable: String, _ arguments: [String], currentDirectory: String? = nil, label: String) throws -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    if let currentDirectory {
        process.currentDirectoryURL = URL(fileURLWithPath: currentDirectory, isDirectory: true)
    }
    process.standardOutput = FileHandle.standardError
    process.standardError = FileHandle.standardError
    do {
        try process.run()
    } catch {
        throw RunnerError(description: "could not start \(label): \(error.localizedDescription)")
    }
    return process
}

func waitFor(_ process: Process, label: String) throws {
    process.waitUntilExit()
    guard process.terminationReason == .exit else {
        throw RunnerError(description: "\(label) terminated by signal \(process.terminationStatus)")
    }
    guard process.terminationStatus == 0 || process.terminationStatus == 36 else {
        throw RunnerError(description: "\(label) exited with code \(process.terminationStatus)")
    }
}

func terminate(_ process: Process?, label: String) {
    guard let process, process.isRunning else { return }
    diagnostic("stopping \(label)")
    process.terminate()
    process.waitUntilExit()
}

func temporaryDirectory(prefix: String) throws -> URL {
    let base = FileManager.default.temporaryDirectory
    let directory = base.appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
    do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    } catch {
        throw RunnerError(description: "could not create temporary directory: \(error.localizedDescription)")
    }
    return directory
}

func copyProjectItem(_ relativePath: String, from sourceRoot: String, to destinationRoot: URL) throws {
    let source = URL(fileURLWithPath: sourceRoot, isDirectory: true).appendingPathComponent(relativePath)
    let destination = destinationRoot.appendingPathComponent(relativePath)
    let parent = destination.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    do {
        try FileManager.default.copyItem(at: source, to: destination)
    } catch {
        throw RunnerError(description: "could not stage \(relativePath): \(error.localizedDescription)")
    }
}

func copyTrackedProjectFiles(_ relativePrefix: String, from sourceRoot: String, to destinationRoot: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
    process.arguments = ["-C", sourceRoot, "ls-files", "--", relativePrefix]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = FileHandle.standardError
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw RunnerError(description: "git ls-files failed for \(relativePrefix)")
    }
    let listing = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let files = listing.split(whereSeparator: { $0 == "\n" || $0 == "\r" }).map(String.init)
    guard !files.isEmpty else {
        throw RunnerError(description: "git index has no files for \(relativePrefix)")
    }
    for file in files {
        try copyProjectItem(file, from: sourceRoot, to: destinationRoot)
    }
}

func sanitizeStagingProject(_ root: URL) throws {
    guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else { return }
    let files = enumerator.compactMap { $0 as? URL }.filter { url in
        (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
    }
    for file in files {
        let name = file.lastPathComponent
        let path = file.path
        let remove = name.hasSuffix(".mjs")
            || name.hasSuffix(".cjs")
            || name.hasSuffix(".test.ts")
            || name.hasSuffix(".test.tsx")
            || name.hasPrefix("validate-") && (name.hasSuffix(".mjs") || name.hasSuffix(".ts"))
            || name.hasPrefix("test-") && (name.hasSuffix(".mjs") || name.hasSuffix(".ts") || name.hasSuffix(".tsx"))
            || name == "production-performance.ts"
            || name == "production-gpu-runner.swift"
            || name == "battle-runner.ts"
            || name == "golden-runner.ts"
            || name == "battle-session-harness-v2.ts"
        if remove {
            try FileManager.default.removeItem(atPath: path)
        }
    }
}

func stageProject(_ sourceRoot: String) throws -> URL {
    let stage = try temporaryDirectory(prefix: "t203-cocos-stage")
    var completed = false
    defer {
        if !completed {
            try? FileManager.default.removeItem(at: stage)
        }
    }
    let items = [
        ".creator",
        "assets/scenes/BattleA0.scene",
        "assets/scenes/BattleA0.scene.meta",
        "build-templates",
        "settings",
        "package.json",
        "tsconfig.json",
    ]
    for item in items {
        try copyProjectItem(item, from: sourceRoot, to: stage)
    }
    try copyTrackedProjectFiles("assets/resources", from: sourceRoot, to: stage)
    // Cocos Creator executes staged script modules during bundle startup, including
    // unrelated meta-game modules with their own runtime validators. Stage only the
    // actual BattleA0 import closure so those modules cannot block the A0 harness.
    for runtimeScriptPath in [
        "assets/scripts/a0/BattleA0Bootstrap.ts",
        "assets/scripts/a0/BattleA0Bootstrap.ts.meta",
        "assets/scripts/config/ConfigLoader.ts",
        "assets/scripts/config/ConfigLoader.ts.meta",
        "assets/scripts/config/levels/ChapterLevelContract.ts",
        "assets/scripts/meta/GameShell.ts",
        "assets/scripts/meta/GameShell.ts.meta",
        "assets/scripts/meta/GameState.ts",
        "assets/scripts/meta/GameState.ts.meta",
    ] {
        try copyProjectItem(runtimeScriptPath, from: sourceRoot, to: stage)
    }
    let sceneLibrary = stage.appendingPathComponent("library/ff/ffbb08e3-cb62-46d3-82aa-b2ac55763131.json")
    try FileManager.default.createDirectory(at: sceneLibrary.deletingLastPathComponent(), withIntermediateDirectories: true)
    let sceneSource = stage.appendingPathComponent("assets/scenes/BattleA0.scene")
    try FileManager.default.copyItem(at: sceneSource, to: sceneLibrary)
    try sanitizeStagingProject(stage)
    completed = true
    return stage
}

func disableSplashScreen(_ buildRoot: String) throws {
    let settingsURL = URL(fileURLWithPath: buildRoot, isDirectory: true).appendingPathComponent("src/settings.json")
    guard FileManager.default.fileExists(atPath: settingsURL.path) else {
        throw RunnerError(description: "Cocos build is missing src/settings.json")
    }
    let data = try Data(contentsOf: settingsURL)
    guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any], var splash = object["splashScreen"] as? [String: Any] else {
        throw RunnerError(description: "Cocos build settings do not expose splashScreen")
    }
    splash["totalTime"] = 0
    splash["logo"] = ["type": "none"]
    splash["background"] = ["type": "none"]
    object["splashScreen"] = splash
    let patched = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    try patched.write(to: settingsURL, options: .atomic)
}

func waitForURL(_ url: URL, timeout: TimeInterval, label: String) throws -> Data {
    let deadline = Date().addingTimeInterval(timeout)
    var lastError = "no response"
    while Date() < deadline {
        do {
            return try Data(contentsOf: url)
        } catch {
            lastError = error.localizedDescription
            Thread.sleep(forTimeInterval: 0.1)
        }
    }
    throw RunnerError(description: "timed out waiting for \(label): \(lastError)")
}

func readJSON(_ data: Data, _ label: String) throws -> [String: Any] {
    do {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RunnerError(description: "\(label) is not an object")
        }
        return object
    } catch let error as RunnerError {
        throw error
    } catch {
        throw RunnerError(description: "\(label) is not valid JSON: \(error.localizedDescription)")
    }
}

func fnv1a(_ input: String) -> String {
    var hash: UInt64 = 14695981039346656037
    for byte in input.utf8 {
        hash ^= UInt64(byte)
        hash = hash &* 1099511628211
    }
    return String(format: "%016llx", hash)
}

final class CDPClient {
    private let session: URLSession
    private let task: URLSessionWebSocketTask
    private let lock = NSLock()
    private let signal = DispatchSemaphore(value: 0)
    private var nextID = 1
    private var responses: [Int: [String: Any]] = [:]
    private var receiveError: String?
    private var closed = false
    private(set) var consoleErrors: [String] = []
    private(set) var exceptions: [String] = []

    init(webSocketURL: URL) throws {
        session = URLSession(configuration: .default)
        task = session.webSocketTask(with: webSocketURL)
        task.resume()
        receiveNext()
    }

    deinit {
        task.cancel(with: .goingAway, reason: nil)
        session.invalidateAndCancel()
    }

    private func receiveNext() {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                self.handle(message)
                self.receiveNext()
            case .failure(let error):
                self.lock.lock()
                self.receiveError = error.localizedDescription
                self.closed = true
                self.lock.unlock()
                self.signal.signal()
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .data(let value):
            data = value
        case .string(let value):
            data = Data(value.utf8)
        @unknown default:
            return
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        lock.lock()
        if let id = object["id"] as? Int {
            responses[id] = object
        } else if object["method"] as? String == "Runtime.consoleAPICalled" {
            if let params = object["params"] as? [String: Any], let type = params["type"] as? String, type == "error" {
                let arguments = (params["args"] as? [[String: Any]] ?? []).map { argument in
                    (argument["value"] as? String)
                        ?? (argument["description"] as? String)
                        ?? (argument["unserializableValue"] as? String)
                        ?? "<unknown>"
                }
                consoleErrors.append("Runtime.consoleAPICalled: " + arguments.joined(separator: " "))
            }
        } else if object["method"] as? String == "Runtime.exceptionThrown" {
            let params = object["params"] as? [String: Any]
            let details = params?["exceptionDetails"] as? [String: Any]
            let text = (details?["text"] as? String)
                ?? ((details?["exception"] as? [String: Any])?["description"] as? String)
                ?? "unknown page exception"
            exceptions.append("Runtime.exceptionThrown: " + text)
        }
        lock.unlock()
        signal.signal()
    }

    func command(_ method: String, params: [String: Any] = [:], timeout: TimeInterval = 30) throws -> [String: Any] {
        lock.lock()
        let id = nextID
        nextID += 1
        lock.unlock()
        let command: [String: Any] = ["id": id, "method": method, "params": params]
        let data: Data
        do {
            data = try JSONSerialization.data(withJSONObject: command, options: [])
        } catch {
            throw RunnerError(description: "could not encode CDP command \(method): \(error.localizedDescription)")
        }
        let sendSignal = DispatchSemaphore(value: 0)
        var sendError: Error?
        task.send(.string(String(decoding: data, as: UTF8.self))) { error in
            sendError = error
            sendSignal.signal()
        }
        _ = sendSignal.wait(timeout: .now() + 10)
        if let sendError {
            throw RunnerError(description: "CDP send \(method) failed: \(sendError.localizedDescription)")
        }

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            lock.lock()
            if let response = responses.removeValue(forKey: id) {
                let error = response["error"] as? [String: Any]
                let result = response["result"] as? [String: Any]
                lock.unlock()
                if let error {
                    let message = (error["message"] as? String) ?? "unknown CDP error"
                    throw RunnerError(description: "CDP \(method) failed: \(message)")
                }
                return result ?? [:]
            }
            let currentReceiveError = receiveError
            let isClosed = closed
            lock.unlock()
            if isClosed {
                throw RunnerError(description: "CDP \(method) connection closed: \(currentReceiveError ?? "unknown error")")
            }
            _ = signal.wait(timeout: .now() + 0.1)
        }
        throw RunnerError(description: "timed out waiting for CDP \(method)")
    }

    func evaluate(_ expression: String, awaitPromise: Bool = false, timeout: TimeInterval = 30) throws -> Any {
        let result = try command(
            "Runtime.evaluate",
            params: [
                "expression": expression,
                "awaitPromise": awaitPromise,
                "returnByValue": true,
                "userGesture": true,
            ],
            timeout: timeout,
        )
        let resultObject = try dictionaryValue(result["result"], "CDP Runtime.evaluate result")
        if let exception = result["exceptionDetails"] as? [String: Any] {
            let description = (exception["text"] as? String) ?? "page evaluation exception"
            throw RunnerError(description: description)
        }
        if resultObject["subtype"] as? String == "error" {
            throw RunnerError(description: (resultObject["description"] as? String) ?? "page evaluation returned an error")
        }
        return try jsonObject(resultObject["value"], "CDP Runtime.evaluate value")
    }
}

func pageDiagnostics(_ client: CDPClient) -> String {
    let expression = """
        (() => ({
          url: String(globalThis.location?.href ?? ''),
          readyState: String(document.readyState),
          hasCanvas: Boolean(document.querySelector('canvas')),
          metrics: globalThis.__A0_METRICS__ ?? null,
          startupError: globalThis.__A0_STARTUP_ERROR__ ?? null,
          bodyText: String(document.body?.innerText ?? '').slice(0, 500)
        }))()
        """
    do {
        let value = try client.evaluate(expression)
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    } catch {
        return "unavailable: " + error.localizedDescription
    }
}

func pageTarget(_ listData: Data) throws -> (id: String, pageURL: URL) {
    let object = try JSONSerialization.jsonObject(with: listData)
    guard let targets = object as? [[String: Any]] else { throw RunnerError(description: "Chrome /json/list is not an array") }
    for target in targets where target["type"] as? String == "page" {
        guard let id = target["id"] as? String, let rawWebSocketURL = target["webSocketDebuggerUrl"] as? String, let webSocketURL = URL(string: rawWebSocketURL) else { continue }
        return (id, webSocketURL)
    }
    throw RunnerError(description: "Chrome did not expose a page target")
}

func pollPageTarget(port: Int, timeout: TimeInterval) throws -> (id: String, pageURL: URL) {
    let endpoint = URL(string: "http://127.0.0.1:\(port)/json/list")!
    let deadline = Date().addingTimeInterval(timeout)
    var lastError = "no page target"
    while Date() < deadline {
        do {
            return try pageTarget(try Data(contentsOf: endpoint))
        } catch {
            lastError = error.localizedDescription
            Thread.sleep(forTimeInterval: 0.1)
        }
    }
    throw RunnerError(description: "timed out waiting for Chrome page target: \(lastError)")
}

func pollBoolean(_ client: CDPClient, expression: String, label: String, timeout: TimeInterval) throws {
    let deadline = Date().addingTimeInterval(timeout)
    var lastError = "condition was false"
    while Date() < deadline {
        do {
            if let value = try client.evaluate(expression) as? Bool, value { return }
        } catch {
            lastError = error.localizedDescription
        }
        Thread.sleep(forTimeInterval: 0.1)
    }
    let consoleErrors = client.consoleErrors.isEmpty ? "none" : client.consoleErrors.joined(separator: " | ")
    let exceptions = client.exceptions.isEmpty ? "none" : client.exceptions.joined(separator: " | ")
    throw RunnerError(description: "timed out waiting for \(label): \(lastError); page=\(pageDiagnostics(client)); consoleErrors=\(consoleErrors); exceptions=\(exceptions)")
}

func run() throws -> [String: Any] {
    let scenarioData = FileHandle.standardInput.readDataToEndOfFile()
    let scenario = try readJSON(scenarioData, "production scenario")
    let clientRoot = FileManager.default.currentDirectoryPath
    let stageRoot = try stageProject(clientRoot)
    defer { try? FileManager.default.removeItem(at: stageRoot) }
    let buildRoot = stageRoot.appendingPathComponent("build/web-desktop", isDirectory: true).path
    let creator = "/Users/jokermok/Applications/CocosCreator-3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator"
    let chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    guard FileManager.default.isExecutableFile(atPath: creator) else { throw RunnerError(description: "Cocos Creator executable is unavailable: \(creator)") }
    guard FileManager.default.isExecutableFile(atPath: chrome) else { throw RunnerError(description: "Google Chrome executable is unavailable: \(chrome)") }

    diagnostic("building Cocos Creator Web Desktop")
    let build = try runProcess(creator, ["--project", stageRoot.path, "--build", "platform=web-desktop;debug=false"], currentDirectory: stageRoot.path, label: "Cocos Creator build")
    try waitFor(build, label: "Cocos Creator build")
    guard FileManager.default.fileExists(atPath: buildRoot), FileManager.default.fileExists(atPath: URL(fileURLWithPath: buildRoot).appendingPathComponent("index.html").path) else {
        throw RunnerError(description: "Cocos Creator build did not produce a complete build/web-desktop")
    }
    try disableSplashScreen(buildRoot)

    let runtimeDirectory = try temporaryDirectory(prefix: "t203-gpu-runner")
    defer { try? FileManager.default.removeItem(at: runtimeDirectory) }
    let serverPort = 4180 + Int.random(in: 1...400)
    let server = try runProcess("/usr/bin/python3", ["-m", "http.server", String(serverPort), "--directory", buildRoot], currentDirectory: clientRoot, label: "Cocos static server")
    defer { terminate(server, label: "Cocos static server") }
    let baseURL = "http://127.0.0.1:\(serverPort)"
    _ = try waitForURL(URL(string: "\(baseURL)/")!, timeout: 15, label: "Cocos static server")

    let chromePort = 46000 + Int.random(in: 1...1000)
    let chromeArguments = [
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=\(chromePort)",
        "--user-data-dir=\(runtimeDirectory.path)",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-extensions",
        "--disable-component-update",
        "--disable-background-networking",
        "--disable-features=Translate,MediaRouter",
        "--enable-gpu",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
        "--window-size=1920,1080",
        "--force-device-scale-factor=1",
        "--autoplay-policy=no-user-gesture-required",
        "--new-window",
        "about:blank",
    ]
    diagnostic("launching headful Chrome with Metal GPU backend on port \(chromePort)")
    let browser = try runProcess(chrome, chromeArguments, label: "headful Chrome")
    defer { terminate(browser, label: "headful Chrome") }

    let versionEndpoint = URL(string: "http://127.0.0.1:\(chromePort)/json/version")!
    let versionData = try waitForURL(versionEndpoint, timeout: 30, label: "Chrome DevTools endpoint")
    let version = try readJSON(versionData, "Chrome /json/version")
    let browserWebSocket = try stringValue(version["webSocketDebuggerUrl"], "Chrome browser websocket")
    let target = try pollPageTarget(port: chromePort, timeout: 30)
    let pageClient = try CDPClient(webSocketURL: target.pageURL)
    let browserClient = try CDPClient(webSocketURL: URL(string: browserWebSocket)!)
    defer {
        _ = try? pageClient.command("Page.close", timeout: 5)
        _ = try? browserClient.command("Browser.close", timeout: 5)
    }

    _ = try pageClient.command("Runtime.enable")
    _ = try pageClient.command("Page.enable")
    _ = try pageClient.command("Emulation.setDeviceMetricsOverride", params: [
        "width": 1920,
        "height": 1080,
        "deviceScaleFactor": 1,
        "mobile": false,
    ])
    _ = try pageClient.command("Page.navigate", params: ["url": "\(baseURL)/"])
    try pollBoolean(pageClient, expression: "Boolean(globalThis.__A0_METRICS__?.ready === true)", label: "Cocos A0 ready", timeout: 45)
    try pollBoolean(pageClient, expression: "Boolean(globalThis.__A0_METRICS__?.assetsReady === true)", label: "Cocos A0 assets", timeout: 45)
    let initial = try pageClient.evaluate("globalThis.__A0_METRICS__")
    let canvas = try pageClient.evaluate("(() => { const node = document.querySelector('canvas'); if (!node) throw new Error('Cocos canvas is missing'); const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height, bufferWidth: node.width, bufferHeight: node.height }; })()")

    _ = try pageClient.evaluate("(() => { globalThis.__A0_ENABLE_STRESS__(); return true; })()")
    try pollBoolean(pageClient, expression: "Boolean(globalThis.__A0_METRICS__?.activeUnits === 24 && globalThis.__A0_METRICS__?.runtimeUnitSprites === 24)", label: "24-unit stress mode", timeout: 30)
    Thread.sleep(forTimeInterval: 1.0)
    _ = try pageClient.evaluate("(() => { globalThis.__A0_TRIGGER_HIT__(); return true; })()")
    try pollBoolean(pageClient, expression: "Boolean(globalThis.__A0_METRICS__?.hitCount === 1 && globalThis.__A0_METRICS__?.enemyHp === 3300)", label: "hit feedback", timeout: 15)

    let frameTimes = try pageClient.evaluate("""
        (() => new Promise((resolve) => {
          const deltas = [];
          let previous;
          let warmupRemaining = 60;
          const sample = (now) => {
            if (previous !== undefined && warmupRemaining <= 0) deltas.push(now - previous);
            previous = now;
            if (warmupRemaining > 0) warmupRemaining -= 1;
            if (deltas.length >= 180) { resolve(deltas); return; }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }))()
        """, awaitPromise: true, timeout: 60)
    let final = try pageClient.evaluate("globalThis.__A0_METRICS__")
    let webgl = try pageClient.evaluate("""
        (() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) throw new Error('Cocos canvas is missing');
          const gl = canvas.getContext('webgl2');
          if (!gl || gl.isContextLost()) throw new Error('live WebGL2 context is unavailable');
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          if (!debug) throw new Error('WEBGL_debug_renderer_info is unavailable');
          return {
            vendor: String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
            renderer: String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
            version: String(gl.getParameter(gl.VERSION)),
            contextType: 'webgl2',
            contextAttributes: gl.getContextAttributes(),
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            contextLost: gl.isContextLost()
          };
        })()
        """)
    let gpuInfo = try browserClient.command("SystemInfo.getInfo")
    let gpu = try dictionaryValue(gpuInfo["gpu"], "Chrome GPU information")
    let devices = gpu["devices"] as? [[String: Any]] ?? []
    guard let device = devices.first else { throw RunnerError(description: "Chrome GPU information has no device") }
    let driverVersion = try stringValue(device["driverVersion"], "Chrome GPU driver version")
    let featureStatus = try dictionaryValue(gpu["featureStatus"], "Chrome GPU feature status")
    let webglFeatureStatus = try stringValue(featureStatus["webgl"], "Chrome WebGL feature status")
    let webglVersion = try stringValue((webgl as? [String: Any])?["version"], "WebGL context version")
    let webgl2FeatureStatus = (featureStatus["webgl2"] as? String) ?? (webglVersion.hasPrefix("WebGL 2.") ? webglFeatureStatus : "")
    diagnostic("Chrome WebGL feature status: webgl=\(webglFeatureStatus), webgl2=\(webgl2FeatureStatus)")
    guard webglFeatureStatus.range(of: "^(?:enabled|hardware[_ ]accelerated)$", options: [.regularExpression, .caseInsensitive]) != nil,
          webgl2FeatureStatus.range(of: "^(?:enabled|hardware[_ ]accelerated)$", options: [.regularExpression, .caseInsensitive]) != nil else {
        throw RunnerError(description: "Chrome WebGL feature status is not an enabled hardware path")
    }
    let gpuVendor = try stringValue((webgl as? [String: Any])?["vendor"], "WebGL GPU vendor")
    let gpuRenderer = try stringValue((webgl as? [String: Any])?["renderer"], "WebGL GPU renderer")
    let contextType = try stringValue((webgl as? [String: Any])?["contextType"], "WebGL context type")
    guard contextType == "webgl2" else { throw RunnerError(description: "Cocos page did not expose a WebGL2 context") }
    let webglContextSignature = "\(target.id)|\(gpuVendor)|\(gpuRenderer)|\(webglVersion)|\((webgl as? [String: Any])?["canvasWidth"] ?? "")x\((webgl as? [String: Any])?["canvasHeight"] ?? "")"
    let gpuContextID = "webgl-\(fnv1a(webglContextSignature))"

    guard let frameValues = frameTimes as? [Any] else { throw RunnerError(description: "rAF sampler did not return an array") }
    let frameTimesMs = try frameValues.map { value -> Double in
        if let number = value as? NSNumber { return number.doubleValue }
        throw RunnerError(description: "rAF sampler returned a non-numeric frame interval")
    }
    guard frameTimesMs.count >= 120 else { throw RunnerError(description: "rAF sampler returned fewer than 120 samples") }
    guard let initialObject = initial as? [String: Any], let finalObject = final as? [String: Any], let canvasObject = canvas as? [String: Any] else {
        throw RunnerError(description: "Cocos metrics or canvas result is not an object")
    }
    guard (initialObject["ready"] as? Bool) == true, (initialObject["assetsReady"] as? Bool) == true else {
        throw RunnerError(description: "Cocos page did not expose ready/assetsReady metrics")
    }
    guard (finalObject["activeUnits"] as? Int) == 24, (finalObject["runtimeUnitSprites"] as? Int) == 24, (finalObject["hitCount"] as? Int) == 1 else {
        throw RunnerError(description: "Cocos page metrics did not confirm the required 24-unit hit scenario")
    }
    guard (canvasObject["bufferWidth"] as? Int ?? 0) >= 1918, (canvasObject["bufferHeight"] as? Int ?? 0) >= 1078 else {
        throw RunnerError(description: "Cocos canvas does not cover the 1920x1080 output")
    }
    guard (webgl as? [String: Any])?["contextLost"] as? Bool == false else { throw RunnerError(description: "live WebGL context was lost") }
    if !pageClient.consoleErrors.isEmpty || !pageClient.exceptions.isEmpty {
        throw RunnerError(description: "Cocos page emitted runtime console errors or exceptions")
    }

    guard let resolution = scenario["resolution"] as? [Int], resolution.count == 2 else {
        throw RunnerError(description: "production scenario resolution is invalid")
    }
    let scenarioWidth = try integerValue(resolution[0], "scenario width")
    let scenarioHeight = try integerValue(resolution[1], "scenario height")
    let scenarioUnits = try integerValue(scenario["units"], "scenario units")
    let scenarioLayers = try integerValue(scenario["sceneLayers"], "scenario sceneLayers")
    let scenarioEffects = try integerValue(scenario["basicEffects"], "scenario basicEffects")
    let scenarioAudio = try integerValue(scenario["audioFeedbacks"], "scenario audioFeedbacks")
    var result: [String: Any] = [
        "runtimeAvailable": true,
        "renderer": "gpu",
        "gpuVendor": gpuVendor,
        "gpuRenderer": gpuRenderer,
        "gpuDriverVersion": driverVersion,
        "gpuContextId": gpuContextID,
        "gpuFeatureStatus": ["webgl": webglFeatureStatus, "webgl2": webgl2FeatureStatus],
        "gpuContextType": contextType,
        "width": scenarioWidth,
        "height": scenarioHeight,
        "units": scenarioUnits,
        "sceneLayers": scenarioLayers,
        "basicEffects": scenarioEffects,
        "audioFeedbacks": scenarioAudio,
        "sceneContractVersion": try stringValue(scenario["sceneContractVersion"], "scenario scene contract version"),
        "effectsAudioContractVersion": try stringValue(scenario["effectsAudioContractVersion"], "scenario effects/audio contract version"),
        "frameTimesMs": frameTimesMs,
    ]
    if let renderer = scenario["renderer"] as? String { result["renderer"] = renderer }
    return result
}

do {
    let result = try run()
    let output = try JSONSerialization.data(withJSONObject: result, options: [])
    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data([10]))
} catch {
    diagnostic(error is RunnerError ? (error as! RunnerError).description : error.localizedDescription)
    exit(EXIT_FAILURE)
}
