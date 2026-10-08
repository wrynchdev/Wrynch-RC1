import AVFoundation
import Observation
import Speech

/// Voice notes: the phone's own speech recognition turns what the technician says into text for their note.
/// The words only land in the note field, for the technician to read and edit; nothing goes to the customer from here.
@MainActor @Observable
final class Dictation {
    enum Failure: LocalizedError {
        case denied, unavailable
        var errorDescription: String? {
            switch self {
            case .denied: return "Microphone or speech recognition is off for Wrynch. Turn both on in Settings › Wrynch."
            case .unavailable: return "Speech recognition isn't available right now. Check the connection and try again."
            }
        }
    }

    private(set) var listening = false
    /// What has been heard so far in this recording.
    private(set) var heard = ""

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var deliver: ((String) -> Void)?
    private var run = 0

    func start(onText: @escaping (String) -> Void) async throws {
        guard !listening else { return }
        guard await Self.authorize() else { throw Failure.denied }
        guard let recognizer = SFSpeechRecognizer(locale: .current) ?? SFSpeechRecognizer(), recognizer.isAvailable else { throw Failure.unavailable }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        // Shop words the recognizer might otherwise miss.
        req.contextualStrings = ["rotor", "caliper", "tie rod", "ball joint", "CV boot", "serpentine belt", "struts", "brake pads", "tread depth", "32nds", "millimeters"]

        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0), block: Self.tap(req))
        engine.prepare()
        try engine.start()

        run += 1
        request = req
        deliver = onText
        heard = ""
        listening = true
        task = recognizer.recognitionTask(with: req, resultHandler: Self.handler { [weak self] text, final in
            guard let self else { return }
            if let text { self.heard = text }
            if final { self.finish() }
        })
    }

    /// Stop listening; the last words arrive a moment later and go into the note.
    func stop() {
        guard listening else { return }
        stopAudio()
        request?.endAudio()
        // If the recognizer never sends a final result, use what was heard.
        let this = run
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            if let self, self.run == this, self.request != nil { self.finish() }
        }
    }

    func cancel() {
        deliver = nil
        task?.cancel()
        finish()
    }

    private func finish() {
        stopAudio()
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        if let deliver, !text.isEmpty { deliver(text.prefix(1).uppercased() + text.dropFirst()) }
        deliver = nil
        task = nil
        request = nil
        heard = ""
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func stopAudio() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
    }

    // Built outside the main actor: the audio tap and the recognizer call back on their own threads.
    nonisolated private static func tap(_ req: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in req.append(buffer) }
    }
    nonisolated private static func handler(_ update: @escaping @MainActor (String?, Bool) -> Void) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { result, error in
            let text = result?.bestTranscription.formattedString
            let final = (result?.isFinal ?? false) || error != nil
            Task { @MainActor in update(text, final) }
        }
    }

    private static func authorize() async -> Bool {
        let speech = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
}
