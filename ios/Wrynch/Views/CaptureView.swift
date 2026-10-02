import SwiftUI
import PhotosUI
import AVFoundation

/// Shoot a stage: pick the corner you're at, then tap (or hold for a burst). Photos upload and sort while you keep
/// shooting. Library photos go straight to the sort screen.
struct CaptureView: View {
    @Environment(AppModel.self) private var model
    let id: String
    let stageId: String
    @Binding var path: [Route]
    @State private var camera = false
    @State private var corner: String?
    @State private var shot: [String: Int] = [:]
    @State private var picks: [PhotosPickerItem] = []

    private var stageName: String { model.overview(id)?.stages.first { $0.id == stageId }?.name ?? "Stage" }
    private var total: Int { shot.values.reduce(0, +) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Card {
                    Text("Where are you shooting?").font(.headline)
                    Text("Tap your corner before you shoot. The AI then only looks for parts at that corner. Left is the driver's side. Leave it off for photos of the whole car or the middle.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                    CornerPicker(corner: $corner, counts: shot)
                    Button { camera = true } label: {
                        Label(corner.map { c in "Open camera · \(Labels.corners.first { $0.key == c }?.label ?? c)" } ?? "Open camera", systemImage: "camera")
                    }
                    .primaryButton()
                    Text("Tap the shutter for each photo or hold it for a burst. You can switch corners without leaving the camera.")
                        .font(.caption).foregroundStyle(Theme.muted)
                    if total > 0 {
                        HStack {
                            Text("\(total) \(total == 1 ? "photo" : "photos") taken").font(.footnote)
                            Spacer()
                            Button("Done · sort photos") { path.removeLast(); path.append(.sort(id, stageId)) }.buttonStyle(.bordered)
                        }
                    }
                }
                Card {
                    Label("Already took them? Pick from your photos", systemImage: "photo.on.rectangle").font(.headline)
                    Text("Pick every photo for this stage at once. Wrynch sorts them onto parts; nothing it suggests counts until you confirm.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                    PhotosPicker(selection: $picks, maxSelectionCount: 60, matching: .images) { Text("Choose photos").secondaryButton() }
                }
            }
            .padding(16)
        }
        .background(Theme.paper)
        .navigationTitle(stageName)
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(isPresented: $camera) {
            CameraScreen(title: stageName, corners: true, initialCorner: corner) { data, c in
                corner = c
                shot[c ?? "none", default: 0] += 1
                Task { await model.addPhotos(id, stageId: stageId, images: [data], corner: c, quiet: true) }
            }
        }
        .onChange(of: picks) { _, items in
            guard !items.isEmpty else { return }
            picks = []
            path.removeLast(); path.append(.sort(id, stageId))
            Task {
                var data: [Data] = []
                for item in items { if let d = try? await item.loadTransferable(type: Data.self) { data.append(d) } }
                await model.addPhotos(id, stageId: stageId, images: data)
            }
        }
    }
}

/// LF / RF / LR / RR around a little car (front at the top).
struct CornerPicker: View {
    @Binding var corner: String?
    var counts: [String: Int] = [:]
    var body: some View {
        Grid(horizontalSpacing: 10, verticalSpacing: 10) {
            GridRow { button(0); car; button(1) }
            GridRow { button(2); Color.clear.frame(height: 1); button(3) }
        }
    }
    private var car: some View {
        VStack(spacing: 2) { Text("Front").font(.caption2).foregroundStyle(Theme.muted); Image(systemName: "car.fill").font(.title2).foregroundStyle(Theme.muted) }
            .gridCellUnsizedAxes(.horizontal)
    }
    private func button(_ i: Int) -> some View {
        let c = Labels.corners[i]
        let on = corner == c.key
        return Button { corner = on ? nil : c.key } label: {
            VStack(spacing: 2) {
                Text(c.short).font(.headline)
                Text(c.label).font(.caption2)
                if let n = counts[c.key], n > 0 { Text("\(n)").font(.caption2.weight(.bold)) }
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(on ? .white : Theme.ink)
            .background(on ? Theme.blue : Theme.card2, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// MARK: camera

/// Full-screen camera: tap the shutter for one photo, hold it for a burst. Each photo is handed back with the corner
/// selected at that moment.
struct CameraScreen: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    var corners: Bool
    var initialCorner: String? = nil
    let onPhoto: (Data, String?) -> Void
    @State private var camera = CameraController()
    @State private var corner: String?
    @State private var count = 0
    @State private var burst: Timer?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraPreview(session: camera.session).ignoresSafeArea()
            VStack {
                HStack {
                    Button { dismiss() } label: { Image(systemName: "xmark").font(.title2).padding(12).background(.black.opacity(0.5), in: Circle()) }
                        .accessibilityLabel("Close camera")
                    Spacer()
                    Text("\(title)\(count > 0 ? " · \(count)" : "")").font(.headline).padding(.horizontal, 12).padding(.vertical, 6).background(.black.opacity(0.5), in: Capsule())
                }
                .padding()
                if let e = camera.error { Text(e).padding().background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 12)).padding() }
                Spacer()
                if corners {
                    HStack(spacing: 8) {
                        ForEach(Labels.corners, id: \.key) { c in
                            let on = corner == c.key
                            Button { corner = on ? nil : c.key } label: {
                                Text(c.short).font(.headline).frame(width: 56, height: 40)
                                    .background(on ? Theme.blue : Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                            }
                            .accessibilityLabel(c.label).accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                }
                Circle().strokeBorder(.white, lineWidth: 5).frame(width: 78, height: 78)
                    .overlay(Circle().fill(.white).padding(9))
                    .padding(.vertical, 20)
                    // Touch down takes a photo; keep holding and it keeps shooting until you let go.
                    .onLongPressGesture(minimumDuration: 60, maximumDistance: 80, perform: {}, onPressingChanged: { pressing in
                        if pressing { startBurst() } else { stopBurst() }
                    })
                    .accessibilityLabel("Shutter")
                    .accessibilityHint("Tap for one photo; hold for a burst")
                    .accessibilityAddTraits(.isButton)
            }
            .foregroundStyle(.white)
        }
        .onAppear {
            corner = initialCorner
            camera.onPhoto = { data in count += 1; onPhoto(data, corner) }
            camera.start()
        }
        .onDisappear { stopBurst(); camera.stop() }
    }

    private func snap() { camera.capture() }
    private func startBurst() {
        guard burst == nil else { return }
        snap()
        // After the first photo, a held shutter shoots about three a second.
        burst = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { _ in Task { @MainActor in snap() } }
        burst?.fireDate = Date().addingTimeInterval(0.6)
    }
    private func stopBurst() { burst?.invalidate(); burst = nil }
}

@Observable
final class CameraController: NSObject, AVCapturePhotoCaptureDelegate {
    @ObservationIgnored let session = AVCaptureSession()
    @ObservationIgnored private let output = AVCapturePhotoOutput()
    @ObservationIgnored private let queue = DispatchQueue(label: "wrynch.camera")
    @ObservationIgnored private var configured = false
    var error: String?
    @ObservationIgnored var onPhoto: ((Data) -> Void)?

    func start() {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
                guard granted else { self.error = "Camera access is off. Turn it on in Settings → Wrynch → Camera."; return }
                self.queue.async { self.configure(); self.session.startRunning() }
            }
        }
    }

    func stop() { queue.async { if self.session.isRunning { self.session.stopRunning() } } }

    private func configure() {
        guard !configured else { return }
        session.beginConfiguration()
        session.sessionPreset = .photo
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
           let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
            session.addInput(input)
        } else {
            DispatchQueue.main.async { self.error = "No camera is available on this device." }
        }
        if session.canAddOutput(output) { session.addOutput(output); output.maxPhotoQualityPrioritization = .speed }
        session.commitConfiguration()
        configured = true
    }

    func capture() {
        queue.async {
            guard self.session.isRunning else { return }
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            settings.photoQualityPrioritization = .speed
            self.output.capturePhoto(with: settings, delegate: self)
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard error == nil, let data = photo.fileDataRepresentation() else { return }
        DispatchQueue.main.async { self.onPhoto?(data) }
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
