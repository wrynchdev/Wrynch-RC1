import SwiftUI
import UIKit

/// Inspection mode: the inspection takes the whole screen, moves point by point (Back / Next), and the technician can
/// jump to any point at any time. Controls are sized for gloved or greasy hands.

extension View {
    /// Whole screen: no status bar or home indicator, and the screen stays awake while the technician works.
    func inspectionChrome() -> some View {
        self.statusBarHidden(true)
            .persistentSystemOverlays(.hidden)
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    }
}

/// Top of a point: a big way back to the overview, the point's name, where it sits in the inspection, and a progress bar.
struct InspectionHeader: View {
    let title: String
    let subtitle: String
    let step: Int
    let steps: Int
    var busy = false
    let onOverview: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button(action: onOverview) {
                    Image(systemName: "square.grid.2x2").font(.title2.weight(.semibold))
                        .frame(width: 60, height: 60)
                        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Inspection overview")
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.title3.weight(.bold)).lineLimit(2).minimumScaleFactor(0.8)
                    Text(subtitle).font(.subheadline).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 0)
                if busy { ProgressView() }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            ProgressView(value: Double(step), total: Double(max(steps, 1))).tint(Theme.ok)
                .accessibilityLabel("Point \(step) of \(steps)")
        }
        .background(Theme.paper)
    }
}

/// Back / Jump / Next, always at the bottom of a point.
struct WizardFooter: View {
    let step: Int
    let steps: Int
    let prevName: String?
    let nextName: String?
    let onBack: () -> Void
    let onJump: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onBack) {
                VStack(spacing: 2) { Image(systemName: "chevron.left").font(.title2.weight(.bold)); Text("Back").font(.subheadline.weight(.semibold)) }
                    .frame(width: 84, height: 72)
                    .background(Theme.card2, in: RoundedRectangle(cornerRadius: 16))
            }
            .accessibilityLabel(prevName.map { "Back to \($0)" } ?? "Back to the overview")
            Button(action: onJump) {
                VStack(spacing: 2) { Image(systemName: "list.bullet").font(.title2.weight(.bold)); Text("\(step)/\(steps)").font(.subheadline.weight(.semibold).monospacedDigit()) }
                    .frame(width: 84, height: 72)
                    .background(Theme.card2, in: RoundedRectangle(cornerRadius: 16))
            }
            .accessibilityLabel("Jump to a point")
            .accessibilityValue("\(step) of \(steps)")
            Button(action: onNext) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(nextName == nil ? "Finish" : "Next").font(.title3.weight(.bold))
                        Text(nextName ?? "Review and send").font(.caption).lineLimit(1).opacity(0.85)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.title2.weight(.bold))
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 72)
                .foregroundStyle(.white)
                .background(Theme.blue, in: RoundedRectangle(cornerRadius: 16))
            }
            .accessibilityLabel(nextName.map { "Next: \($0)" } ?? "Finish")
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 6)
        .background(.ultraThinMaterial)
    }
}

/// Every point, stage by stage, with how far each has got. Tap one to go straight there.
struct JumpSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    let current: String?
    let onPoint: (String) -> Void
    let onOverview: () -> Void
    let onFinish: () -> Void

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 10) {
                            Button { dismiss(); onOverview() } label: { Label("Overview", systemImage: "square.grid.2x2") }.secondaryButton()
                                .accessibilityLabel("Overview")
                            Button { dismiss(); onFinish() } label: { Label("Finish", systemImage: "checkmark") }.secondaryButton()
                        }
                        if let vm = model.overview(id) {
                            ForEach(vm.stages) { s in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(s.name.uppercased()).font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                                    ForEach(s.points) { p in row(p).id(p.id) }
                                }
                            }
                        } else {
                            ProgressView()
                        }
                    }
                    .padding(16)
                }
                .onAppear { if let current { reader.scrollTo(current, anchor: .center) } }
            }
            .background(Theme.card)
            .navigationTitle("Jump to a point")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark").font(.title3.weight(.bold)).frame(width: 48, height: 48) }
                        .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ p: OverviewVM.PointRow) -> some View {
        let here = p.id == current
        return Button { dismiss(); onPoint(p.id) } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle().strokeBorder(p.done ? Theme.ok : Theme.line, lineWidth: 2)
                        .background(Circle().fill(p.done ? Theme.ok : .clear))
                    if p.done { Image(systemName: "checkmark").font(.caption.weight(.heavy)).foregroundStyle(.black) }
                }
                .frame(width: 28, height: 28)
                Text(p.name).font(.headline).multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                if let badge = p.badge {
                    if p.ai { AiChip(text: badge) } else { Text(badge).font(.caption.weight(.semibold)).foregroundStyle(Theme.na) }
                } else { StateChip(state: p.state) }
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(here ? Theme.blue.opacity(0.22) : Theme.card2, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(here ? Theme.blue : .clear, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(p.name)\(p.done ? ", done" : "")")
        .accessibilityAddTraits(here ? .isSelected : [])
    }
}

/// A big microphone button: speak, and the words go into the technician's note.
struct MicButton: View {
    @Environment(AppModel.self) private var model
    @State private var dictation = Dictation()
    var disabled = false
    let onText: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                if dictation.listening { dictation.stop() }
                else { Task { do { try await dictation.start(onText: onText) } catch { model.show(error) } } }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: dictation.listening ? "stop.circle.fill" : "mic.fill").font(.title2)
                        .symbolEffect(.pulse, isActive: dictation.listening)
                    Text(dictation.listening ? "Listening · tap to stop" : "Speak a note").font(.headline)
                }
                .frame(maxWidth: .infinity, minHeight: 64)
                .foregroundStyle(dictation.listening ? .white : Theme.ink)
                .background(dictation.listening ? Theme.immediate : Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(dictation.listening ? .clear : Theme.line))
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .accessibilityLabel(dictation.listening ? "Stop voice note" : "Speak a note")
            if dictation.listening {
                Text(dictation.heard.isEmpty ? "Say what you found. Your words go into the note." : dictation.heard)
                    .font(.footnote).foregroundStyle(Theme.muted)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .onDisappear { dictation.stop() }
    }
}
