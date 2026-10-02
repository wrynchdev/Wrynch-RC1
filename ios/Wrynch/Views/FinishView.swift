import SwiftUI

/// Finish: what still needs the technician, the automatic notes to approve, and Send to advisor.
struct FinishView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @Binding var path: [Route]
    @State private var tried: Set<String> = []
    @State private var writing: (done: Int, total: Int)?
    @State private var sending = false

    var body: some View {
        Group {
            if let vm = model.finish(id) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if vm.gateCount > 0 {
                            Card {
                                Label("\(vm.gateCount) \(vm.gateCount == 1 ? "thing needs" : "things need") you first", systemImage: "lock").font(.headline)
                                Text("Nothing unconfirmed can reach the advisor or the customer.").font(.footnote).foregroundStyle(Theme.muted)
                                if !vm.notes.isEmpty { Text("\(vm.notes.count) automatic note\(vm.notes.count == 1 ? "" : "s") to approve below.").font(.footnote).foregroundStyle(Theme.muted) }
                                ForEach(vm.items.prefix(30)) { item in
                                    Button { open(item) } label: {
                                        HStack {
                                            Image(systemName: item.kind == "ai_finding" ? "sparkles" : item.kind == "photo" ? "photo" : "circle.dashed")
                                            VStack(alignment: .leading) {
                                                Text(item.title).font(.subheadline.weight(.semibold))
                                                Text(item.detail).font(.caption).foregroundStyle(Theme.muted)
                                            }
                                            Spacer()
                                            Text("Open").font(.caption.weight(.bold)).foregroundStyle(Theme.blueText)
                                        }
                                        .padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 10))
                                    }
                                    .buttonStyle(.plain)
                                }
                                if vm.items.count > 30 { Text("+ \(vm.items.count - 30) more").font(.caption).foregroundStyle(Theme.muted) }
                            }
                        } else {
                            Card { Label("Every required part is rated and every AI item is resolved.", systemImage: "checkmark.circle").foregroundStyle(Theme.ok) }
                        }
                        Text("\(vm.summary.total) parts on this car").font(.headline)
                        Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                            GridRow {
                                Tile(value: vm.summary.immediate, label: "Immediate", color: Theme.immediate)
                                Tile(value: vm.summary.monitor, label: "Monitor", color: Theme.monitor)
                                Tile(value: vm.summary.ok, label: "OK", color: Theme.ok)
                            }
                            GridRow {
                                Tile(value: vm.summary.notChecked, label: "Not checked", color: Theme.na)
                                Tile(value: vm.summary.unrated, label: "Not rated yet", color: Theme.na)
                                Tile(value: vm.aiToReview, label: "AI to review", color: Theme.ai)
                            }
                        }
                        if writing != nil || !vm.notes.isEmpty || vm.ready {
                            Card {
                                Label("Automatic notes", systemImage: "sparkles").font(.headline)
                                if let w = writing {
                                    Text("Writing notes… \(w.done) of \(w.total)").font(.footnote).foregroundStyle(Theme.muted)
                                } else if !vm.notes.isEmpty {
                                    Text("Blank notes were drafted from your confirmed ratings and photos; your notes were reworded, keeping every measurement. Nothing reaches the advisor or the customer until you approve it.")
                                        .font(.footnote).foregroundStyle(Theme.muted)
                                } else {
                                    Text("All notes are reviewed.").font(.footnote).foregroundStyle(Theme.muted)
                                }
                                if writing == nil && vm.notes.count > 1 {
                                    Button { for n in vm.notes { model.resolveWording(id, pointId: n.pointId, action: "accept") } } label: {
                                        Label("Approve all \(vm.notes.count) as written", systemImage: "checkmark")
                                    }
                                    .secondaryButton()
                                }
                                ForEach(vm.notes) { n in NoteReview(id: id, note: n) }
                            }
                        }
                    }
                    .padding(16).padding(.bottom, 80)
                }
                .safeAreaInset(edge: .bottom) {
                    Group {
                        if vm.status == "in_progress" {
                            Button {
                                Task { sending = true; if await model.submit(id) { path.removeLast(); model.show("Sent to the advisor.") }; sending = false }
                            } label: {
                                if sending { ProgressView().tint(.white) } else if vm.gateCount > 0 { Label("Send to advisor", systemImage: "lock") } else { Text("Send to advisor") }
                            }
                            .primaryButton(vm.gateCount == 0)
                            .disabled(vm.gateCount > 0 || sending)
                        } else {
                            Text("With the advisor. Open wrynch.app for the advisor view.").font(.footnote).foregroundStyle(Theme.muted)
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 8)
                }
                .task(id: vm.autoNoteTodo.filter { !tried.contains($0) }.joined(separator: ",")) { await writeNotes(vm) }
            } else {
                ProgressView()
            }
        }
        .background(Theme.paper)
        .navigationTitle("Finish inspection")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadInspection(id) }
    }

    /// Once every required part is rated, write the automatic notes: reword the tech's notes, draft the blank ones.
    private func writeNotes(_ vm: FinishVM) async {
        let todo = vm.autoNoteTodo.filter { !tried.contains($0) }
        guard !todo.isEmpty, writing == nil else { return }
        tried.formUnion(todo)
        writing = (0, todo.count)
        let failed = await model.autoNotes(id, pointIds: todo)
        writing = nil
        if failed > 0 { model.show("\(failed) note\(failed == 1 ? "" : "s") couldn’t be written automatically; the technician’s own note stays.", error: true) }
    }

    private func open(_ item: FinishVM.Item) {
        if let k = item.partKey { path.append(.part(id, k)) }
        else if let s = item.stageId { path.append(.sort(id, s)) }
    }
}

private struct NoteReview: View {
    @Environment(AppModel.self) private var model
    let id: String
    let note: FinishVM.Note
    @State private var text: String?

    var body: some View {
        let current = text ?? note.aiText
        let changed = current.trimmingCharacters(in: .whitespacesAndNewlines) != note.aiText.trimmingCharacters(in: .whitespacesAndNewlines)
        AiBox {
            HStack { Text(note.point).font(.subheadline.weight(.bold)); Spacer(); AiChip(text: "\(note.techText.isEmpty ? "Drafted" : "Reworded") · not approved") }
            if !note.techText.isEmpty { Text("Your note: \(note.techText)").font(.caption.monospaced()).foregroundStyle(Theme.muted) }
            TextField("Automatic note", text: Binding(get: { current }, set: { text = $0 }), axis: .vertical).lineLimit(2...8)
                .padding(8).background(Theme.card2, in: RoundedRectangle(cornerRadius: 8))
            HStack {
                Button(note.techText.isEmpty ? "Skip" : "Keep mine") { model.resolveWording(id, pointId: note.pointId, action: "reject") }.secondaryButton()
                Button(changed ? "Approve edit" : "Approve") {
                    if changed { model.resolveWording(id, pointId: note.pointId, action: "edit", text: current.trimmingCharacters(in: .whitespacesAndNewlines)) }
                    else { model.resolveWording(id, pointId: note.pointId, action: "accept") }
                }
                .primaryButton(!current.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }
}

/// The customer's version of one note: approve, edit or keep the technician's own.
struct WordingView: View {
    @Environment(AppModel.self) private var model
    let id: String
    let pointId: String
    @State private var editing: String?

    private var note: JSONValue? { model.bundle(id)?.inspection["notes"]?.array?.first { $0["pointId"]?.string == pointId } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Card {
                    Text("Your note · always kept").font(.caption).foregroundStyle(Theme.muted)
                    Text(note?["techText"]?.string.flatMap { $0.isEmpty ? nil : $0 } ?? "—").font(.body.monospaced())
                }
                if let n = note, n["status"]?.string == "ai_suggested", let ai = n["aiText"]?.string {
                    AiBox {
                        HStack { Label("Suggested for the customer", systemImage: "sparkles").font(.subheadline.weight(.bold)).foregroundStyle(Theme.ai); Spacer(); AiChip(text: "Not approved") }
                        if let e = editing {
                            TextField("Wording", text: Binding(get: { e }, set: { editing = $0 }), axis: .vertical).lineLimit(3...8)
                        } else { Text(ai) }
                        Label("Keeps every measurement, adds no findings or repairs", systemImage: "checkmark").font(.caption).foregroundStyle(Theme.ok)
                    }
                    HStack {
                        Button("Keep mine") { model.resolveWording(id, pointId: pointId, action: "reject") }.secondaryButton()
                        if let e = editing {
                            Button("Save edit") { model.resolveWording(id, pointId: pointId, action: "edit", text: e); editing = nil }.secondaryButton()
                        } else {
                            Button("Edit") { editing = ai }.secondaryButton()
                        }
                        Button("Approve") { model.resolveWording(id, pointId: pointId, action: "accept") }.primaryButton()
                    }
                } else if let n = note, let c = n["customerText"]?.string, !c.isEmpty {
                    Card {
                        Text("Customer sees (\((n["status"]?.string ?? "").replacingOccurrences(of: "_", with: " ")))").font(.caption).foregroundStyle(Theme.muted)
                        Text(c)
                    }
                }
                if let n = note, n["status"]?.string != "ai_suggested", model.bundle(id)?.status == "in_progress" {
                    Button {
                        Task {
                            model.busy = "Writing a customer version…"
                            await model.settle(id)
                            do { _ = try await model.api.fn("ai-wording", body: ["inspectionId": .string(id), "pointId": .string(pointId)]) } catch { model.show(error) }
                            model.busy = nil
                            await model.loadInspection(id)
                        }
                    } label: { Label("Suggest customer wording", systemImage: "sparkles") }
                    .secondaryButton()
                }
                Text("AI may only reword your note, or draft one from your confirmed ratings when it's blank. The customer sees nothing until you approve it.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            .padding(16)
        }
        .background(Theme.paper)
        .navigationTitle("Customer wording")
        .navigationBarTitleDisplayMode(.inline)
    }
}
