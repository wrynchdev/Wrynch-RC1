import SwiftUI
import PhotosUI

/// One inspection point: its parts by corner, AI suggestions, "nothing found", photos and the note.
struct PointView: View {
    @Environment(AppModel.self) private var model
    let id: String
    let pointId: String
    @Binding var path: [Route]
    @State private var note: String?
    @State private var draft: String?
    @State private var drafting = false
    @State private var picks: [PhotosPickerItem] = []
    @State private var camera = false
    @FocusState private var noteFocused: Bool

    var body: some View {
        Group {
            if let vm = model.point(id, pointId) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) { content(vm) }.padding(16).padding(.bottom, 80)
                }
                .safeAreaInset(edge: .bottom) {
                    Group {
                        if let next = vm.nextPoint {
                            Button { saveNote(); path.removeLast(); path.append(.point(id, next.id)) } label: { Label("Next: \(next.name)", systemImage: "chevron.right") }
                        } else {
                            Button { saveNote(); path.removeLast() } label: { Text("Back to overview") }
                        }
                    }
                    .primaryButton().padding(.horizontal, 16).padding(.bottom, 8)
                }
                .navigationTitle(vm.name)
                .fullScreenCover(isPresented: $camera) {
                    CameraScreen(title: vm.name, corners: false) { data, _ in
                        Task { await model.addPhotos(id, stageId: vm.stageId, images: [data], pointId: pointId, quiet: true) }
                    }
                }
                .onChange(of: picks) { _, items in
                    guard !items.isEmpty else { return }
                    picks = []
                    Task {
                        var data: [Data] = []
                        for item in items { if let d = try? await item.loadTransferable(type: Data.self) { data.append(d) } }
                        await model.addPhotos(id, stageId: vm.stageId, images: data, pointId: pointId)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .background(Theme.paper)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if model.saving.contains(id) { ToolbarItem(placement: .topBarTrailing) { ProgressView() } } }
        .onDisappear { saveNote() }
        .task { if model.bundle(id) == nil { await model.loadInspection(id) } }
    }

    @ViewBuilder private func content(_ vm: PointVM) -> some View {
        Text(vm.stageName).font(.footnote).foregroundStyle(Theme.muted)
        if vm.partCount == 0 {
            Card { Text(vm.note ?? "This point has no parts on this vehicle.").font(.subheadline) }
        } else {
            Card {
                HStack(spacing: 10) {
                    StateChip(state: vm.state, large: true)
                    Text("The point shows its worst part. Each part keeps its own rating and history.").font(.footnote).foregroundStyle(Theme.muted)
                }
            }
        }
        ForEach(vm.groups) { g in
            VStack(alignment: .leading, spacing: 0) {
                Text(g.title.uppercased()).font(.caption.weight(.bold)).foregroundStyle(Theme.muted).padding(14)
                ForEach(g.parts) { p in
                    NavigationLink(value: Route.part(id, p.key)) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.subheadline.weight(.semibold))
                                Text(p.detail).font(.caption).foregroundStyle(p.badge != nil ? Theme.ai : Theme.muted)
                            }
                            Spacer()
                            if let badge = p.badge { AiChip(text: badge) } else { StateChip(state: p.state) }
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.muted)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                    Divider().background(Theme.line).padding(.leading, 14)
                }
            }
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
        }
        if vm.notApplicable.count > 0 {
            Card {
                Text("\(vm.notApplicable.count) parts don't apply").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
                Text(vm.notApplicable.labels.joined(separator: ", ")).font(.caption).foregroundStyle(Theme.muted)
            }
        }
        if !vm.locked && !vm.looksOk.ids.isEmpty {
            AiBox {
                Text("AI thinks \(vm.looksOk.ids.count) \(vm.looksOk.ids.count == 1 ? "part looks" : "parts look") OK in the photos: \(vm.looksOk.parts.joined(separator: ", ")). Nothing counts until you confirm.")
                    .font(.footnote)
                HStack {
                    Button("Confirm looks OK") { model.reviewLooksOk(id, ids: vm.looksOk.ids, confirm: true) }.primaryButton()
                    Button("Dismiss") { model.reviewLooksOk(id, ids: vm.looksOk.ids, confirm: false) }.secondaryButton().frame(maxWidth: 120)
                }
            }
        }
        if !vm.locked && vm.unrated > 0 {
            Button { model.markPointOk(id, pointId: pointId) } label: {
                Label("Nothing found on the other \(vm.unrated) \(vm.unrated == 1 ? "part" : "parts")", systemImage: "checkmark")
            }
            .secondaryButton()
        }
        if !vm.photos.isEmpty || (!vm.locked && vm.partCount > 0) {
            HStack {
                Text("Photos · \(vm.photos.count)").font(.headline)
                Spacer()
                if !vm.locked && vm.partCount > 0 {
                    Button { camera = true } label: { Image(systemName: "camera") }.accessibilityLabel("Take photos for this point")
                    PhotosPicker(selection: $picks, maxSelectionCount: 20, matching: .images) { Image(systemName: "photo.on.rectangle") }
                        .accessibilityLabel("Add photos from the library")
                }
            }
            if vm.photos.isEmpty { Text("Photos added here are matched only to this point's parts.").font(.footnote).foregroundStyle(Theme.muted) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(vm.photos) { ph in
                        Button {
                            if let k = ph.firstPart { path.append(.part(id, k)) } else { path.append(.sort(id, vm.stageId)) }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                PhotoThumb(path: ph.path, size: 110, pending: ph.pending)
                                Text(ph.caption).font(.caption2).lineLimit(2).frame(width: 110, alignment: .leading)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        Card {
            Text("Your note").font(.headline)
            Text("The customer sees this note as written, unless you approve a reworded version.").font(.caption).foregroundStyle(Theme.muted)
            TextField("Note", text: Binding(get: { note ?? vm.noteText }, set: { note = $0 }), axis: .vertical)
                .lineLimit(2...6).focused($noteFocused).disabled(vm.locked)
                .padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 10))
                .onChange(of: noteFocused) { _, focused in if !focused { saveNote() } }
            if !vm.locked, draft == nil {
                Button {
                    Task {
                        saveNote(); drafting = true
                        do { draft = try await model.draftNote(id, pointId: pointId) } catch { model.show(error) }
                        drafting = false
                    }
                } label: {
                    Label(drafting ? "Writing a draft…" : ((note ?? vm.noteText).isEmpty ? "Draft note with AI" : "Redraft with AI"), systemImage: "sparkles")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ai)
                }
                .disabled(drafting)
            }
            if let d = draft {
                AiBox {
                    HStack { Label("AI draft", systemImage: "sparkles").foregroundStyle(Theme.ai).font(.subheadline.weight(.bold)); Spacer(); AiChip(text: "Not your note yet") }
                    TextField("Draft", text: Binding(get: { d }, set: { draft = $0 }), axis: .vertical).lineLimit(3...8)
                    Text("Check it and edit anything before you use it.").font(.caption).foregroundStyle(Theme.muted)
                    HStack {
                        Button((note ?? vm.noteText).isEmpty ? "Use this note" : "Replace my note") {
                            let t = d.trimmingCharacters(in: .whitespacesAndNewlines)
                            model.setNote(id, pointId: pointId, text: t); note = nil; draft = nil
                        }
                        .primaryButton(!d.trimmingCharacters(in: .whitespaces).isEmpty)
                        Button("Discard") { draft = nil }.secondaryButton().frame(maxWidth: 110)
                    }
                }
            }
            if !vm.locked && !(note ?? vm.noteText).isEmpty {
                NavigationLink(value: Route.wording(id, pointId)) {
                    Label(vm.noteStatus == "ai_suggested" ? "Customer wording suggested · review" : "Customer wording", systemImage: "sparkles")
                        .font(.footnote.weight(.bold)).foregroundStyle(Theme.ai)
                }
                .simultaneousGesture(TapGesture().onEnded { saveNote() })
            }
        }
    }

    private func saveNote() {
        guard let n = note, n != model.point(id, pointId)?.noteText else { return }
        model.setNote(id, pointId: pointId, text: n)
        note = nil
    }
}
