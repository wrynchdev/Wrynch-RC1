import SwiftUI

/// The AI's photo placements for a stage: confirm them, change a photo's parts, or exclude it.
struct SortView: View {
    @Environment(AppModel.self) private var model
    let id: String
    let stageId: String
    @Binding var path: [Route]
    @State private var placing: String?

    var body: some View {
        Group {
            if let vm = model.sort(id, stageId) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if vm.total == 0 {
                            Card {
                                Text(model.busy != nil ? "Working on your photos…" : "No photos yet").font(.headline)
                                if model.busy == nil && !vm.locked { Button { path.append(.capture(id, stageId)) } label: { Label("Capture this stage", systemImage: "camera") }.primaryButton() }
                            }
                        } else if !model.aiOn {
                            Card { Text("**AI photo sorting isn’t set up for this shop yet.** Tap a photo to pick the parts it shows.").font(.footnote) }
                        } else if vm.noneRead {
                            AiBox { Text("The AI hasn’t read these photos yet. Tap “Sort with AI”, or place them by hand.").font(.footnote) }
                        } else {
                            AiBox {
                                Text("**AI found \(vm.partsSeen) parts in \(vm.total - vm.needs.count) of \(vm.total) photos** and noted the condition of each. A photo can show several parts and counts for each of their points. Dashed = not confirmed yet; “check side” = right part, side not certain.")
                                    .font(.footnote)
                            }
                        }
                        if !vm.needs.isEmpty {
                            HStack {
                                Text("Needs you · \(vm.needs.count)").font(.headline)
                                Spacer()
                                if model.aiOn && vm.unread > 0 && model.busy == nil && !vm.locked {
                                    Button { Task { await model.sortWithAi(id, mediaIds: model.unreadPhotos(id, stageId: stageId)); await model.loadInspection(id) } } label: {
                                        Label("Sort \(vm.unread) with AI", systemImage: "sparkles")
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                            ForEach(vm.needs) { m in
                                HStack(spacing: 12) {
                                    PhotoThumb(path: m.path, size: 64)
                                    VStack(alignment: .leading) {
                                        Text(m.analyzed ? "AI couldn’t tell" : "Not sorted yet").font(.subheadline.weight(.semibold))
                                        Text("Pick the parts it shows").font(.caption).foregroundStyle(Theme.muted)
                                    }
                                    Spacer()
                                    if !vm.locked {
                                        Button("Place") { placing = m.id }.buttonStyle(.bordered)
                                        Button("Exclude") { model.excludePhoto(id, mediaId: m.id) }.font(.caption)
                                    }
                                }
                                .padding(10).background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
                            }
                        }
                        ForEach(vm.points) { p in
                            HStack {
                                Text("\(p.name) · \(p.photos.count)").font(.headline)
                                Spacer()
                                Button("Open point") { path.append(.point(id, p.id)) }.font(.footnote.weight(.bold))
                            }
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                                ForEach(p.photos) { ph in
                                    Button { placing = ph.id } label: {
                                        VStack(alignment: .leading, spacing: 3) {
                                            PhotoThumb(path: ph.path, size: 104, pending: ph.pending)
                                            Text(ph.caption).font(.caption2).lineLimit(2)
                                            Text(ph.status).font(.caption2.weight(.semibold)).foregroundStyle(ph.pending ? Theme.ai : Theme.ok)
                                        }
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Photo showing \(ph.caption). \(ph.status). Tap to change.")
                                    .disabled(vm.locked)
                                }
                            }
                        }
                    }
                    .padding(16).padding(.bottom, 80)
                }
                .safeAreaInset(edge: .bottom) {
                    if vm.total > 0 && !vm.locked {
                        HStack(spacing: 10) {
                            Button { path.append(.capture(id, stageId)) } label: { Image(systemName: "camera") }.secondaryButton().frame(width: 60)
                                .accessibilityLabel("Add photos")
                            Button(vm.proposedLinks > 0 ? "Confirm \(vm.proposedLinks) AI part matches" : "All matches confirmed") {
                                model.confirmPlacements(id, stageId: stageId)
                            }
                            .primaryButton(vm.proposedLinks > 0).disabled(vm.proposedLinks == 0)
                        }
                        .padding(.horizontal, 16).padding(.bottom, 8)
                    }
                }
                .navigationTitle("Sort photos")
                .sheet(item: Binding(get: { placing.map { PlaceTarget(id: $0) } }, set: { placing = $0?.id })) { t in
                    PlaceSheet(id: id, mediaId: t.id)
                }
            } else {
                ProgressView()
            }
        }
        .background(Theme.paper)
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadInspection(id) }
    }
}

private struct PlaceTarget: Identifiable { let id: String }

/// Choose every part a photo shows. Parts are grouped by inspection point; a part can sit in several points.
private struct PlaceSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    let mediaId: String
    @State private var picked: Set<String>?
    @State private var query = ""
    @State private var showAll = false

    var body: some View {
        NavigationStack {
            if let vm = model.place(id, mediaId) {
                let chosen = picked ?? Set(vm.picked)
                List {
                    Section {
                        PhotoThumb(path: vm.path, size: 220).frame(maxWidth: .infinity)
                        ForEach(vm.aiSaw, id: \.self) { s in
                            Label { Text("**\(s.part)** · \(s.detail)").font(.footnote) } icon: { Image(systemName: "sparkles").foregroundStyle(Theme.ai) }
                        }
                    }
                    ForEach(groups(vm, chosen: chosen)) { g in
                        Section(g.sameStage ? g.point : "\(g.point) · \(g.stage)") {
                            ForEach(g.parts) { p in
                                Button {
                                    var next = chosen
                                    if next.contains(p.key) { next.remove(p.key) } else { next.insert(p.key) }
                                    picked = next
                                } label: {
                                    HStack {
                                        Text(p.label)
                                        if p.ai { AiChip(text: "AI") }
                                        Spacer()
                                        if chosen.contains(p.key) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.blue) }
                                    }
                                }
                            }
                        }
                    }
                    if !showAll && query.isEmpty { Button("Show parts from other stages") { showAll = true } }
                    Section {
                        Text("Removing a part also drops what the AI suggested about it from this photo.").font(.caption).foregroundStyle(Theme.muted)
                        Button("Exclude photo", role: .destructive) { model.excludePhoto(id, mediaId: mediaId); dismiss() }
                    }
                }
                .searchable(text: $query, prompt: "Search parts (e.g. strut, LF tire)")
                .navigationTitle("Parts in this photo")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(chosen.isEmpty ? "Pick a part" : "Save \(chosen.count)") {
                            model.setPhotoParts(id, mediaId: mediaId, keys: Array(chosen)); dismiss()
                        }
                        .disabled(chosen.isEmpty)
                    }
                }
            } else {
                ProgressView()
            }
        }
    }

    private func groups(_ vm: PlaceVM, chosen: Set<String>) -> [PlaceVM.Group] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return vm.groups.compactMap { g in
            let parts = q.isEmpty ? g.parts : g.parts.filter { $0.label.lowercased().contains(q) }
            guard !parts.isEmpty else { return nil }
            guard showAll || !q.isEmpty || g.sameStage || parts.contains(where: { chosen.contains($0.key) }) else { return nil }
            return PlaceVM.Group(stage: g.stage, sameStage: g.sameStage, point: g.point, parts: parts)
        }
    }
}
