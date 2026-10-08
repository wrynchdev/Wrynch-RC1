import SwiftUI

/// One inspection: progress, the rating counts, and the stages (one open at a time).
struct OverviewView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @Binding var path: [Route]
    @State private var openStage: String??   // nil = not picked yet; .some(nil) = all closed
    @State private var jumping = false

    var body: some View {
        Group {
            if let vm = model.overview(id), let b = model.bundle(id) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if vm.locked && vm.status != "not_started" {
                            Card { Label("Sent to the advisor. Changes are locked.", systemImage: "lock") }
                        }
                        if !vm.locked, let resume = vm.resumePointId {
                            HStack(spacing: 10) {
                                Button { path.append(.point(id, resume)) } label: {
                                    Label(vm.pointsDone == 0 ? "Start with the first point" : "Continue inspection", systemImage: "play.fill")
                                }
                                .primaryButton()
                                Button { jumping = true } label: { Image(systemName: "list.bullet").font(.title2.weight(.bold)) }
                                    .secondaryButton().frame(width: 76)
                                    .accessibilityLabel("Jump to a point")
                            }
                        }
                        Card {
                            HStack {
                                Text("\(vm.pointsDone) of \(vm.pointsTotal) points done").font(.headline)
                                Spacer()
                                Text("\(vm.photos) photos").font(.footnote).foregroundStyle(Theme.muted)
                            }
                            InspectionClock(startedAt: b.startedAt, firstSubmittedAt: b.firstSubmittedAt)
                            ProgressView(value: Double(vm.pointsDone), total: Double(max(vm.pointsTotal, 1))).tint(Theme.blue)
                            HStack(spacing: 8) {
                                Tile(value: vm.summary.immediate, label: "Immediate", color: Theme.immediate)
                                Tile(value: vm.summary.monitor, label: "Monitor", color: Theme.monitor)
                                Tile(value: vm.summary.ok, label: "OK", color: Theme.ok)
                                Tile(value: vm.aiItems, label: "AI to review", color: Theme.ai)
                            }
                            if !vm.dtcs.isEmpty { Text("Codes read: \(vm.dtcs.joined(separator: " · "))").font(.footnote.monospaced()).foregroundStyle(Theme.muted) }
                        }
                        ForEach(vm.stages) { s in stage(s, vm: vm) }
                    }
                    .padding(16)
                    .padding(.bottom, 80)
                }
                .safeAreaInset(edge: .bottom) {
                    if !vm.locked {
                        Button { path.append(.finish(id)) } label: {
                            if vm.gateCount > 0 { Label("Finish · \(vm.gateCount) items left", systemImage: "lock") } else { Text("Finish inspection") }
                        }
                        .primaryButton(vm.gateCount == 0)
                        .padding(.horizontal, 16).padding(.bottom, 8)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .background(Theme.paper)
        .navigationTitle(model.overview(id)?.title ?? "Inspection")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack {
                    if model.saving.contains(id) { ProgressView() }
                    Button("Vehicle") { path.append(.setup(id)) }
                }
            }
        }
        .sheet(isPresented: $jumping) {
            JumpSheet(id: id, current: nil, onPoint: { path.append(.point(id, $0)) }, onOverview: {}, onFinish: { path.append(.finish(id)) })
        }
        .inspectionChrome()
        .task { await model.loadInspection(id) }
        .refreshable { await model.loadInspection(id) }
    }

    private func current(_ vm: OverviewVM) -> String? {
        if let picked = openStage { return picked }
        return vm.firstOpenStage
    }

    @ViewBuilder private func stage(_ s: OverviewVM.Stage, vm: OverviewVM) -> some View {
        let open = current(vm) == s.id
        VStack(spacing: 0) {
            Button {
                withAnimation(.snappy) { openStage = .some(open ? nil : s.id) }
            } label: {
                HStack(spacing: 12) {
                    Text("\(s.done)/\(s.total)").font(.caption.weight(.bold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background((s.complete ? Theme.ok : Theme.na).opacity(0.18), in: Capsule())
                        .foregroundStyle(s.complete ? Theme.ok : Theme.na)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.name).font(.headline)
                        Text("\(s.photos) photos\(s.pending > 0 ? " · \(s.pending) AI items to review" : "")").font(.footnote).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Image(systemName: open ? "chevron.down" : "chevron.right").foregroundStyle(Theme.muted)
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(open ? .isSelected : [])
            .accessibilityHint(open ? "Closes this stage" : "Opens this stage and closes the others")
            if open {
                if s.pending > 0 {
                    AiBox { Text("\(s.pending) AI items wait for you in this stage.").font(.footnote) }.padding(.horizontal, 14).padding(.bottom, 8)
                }
                Divider().background(Theme.line)
                ForEach(s.points) { p in
                    Button { path.append(.point(id, p.id)) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                                Text("\(p.parts) \(p.parts == 1 ? "part" : "parts")\(p.photos > 0 ? " · \(p.photos) \(p.photos == 1 ? "photo" : "photos")" : "")").font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            if let badge = p.badge {
                                if p.ai { AiChip(text: badge) } else { Text(badge).font(.caption.weight(.semibold)).foregroundStyle(Theme.na) }
                            } else { StateChip(state: p.state) }
                        }
                        .padding(.horizontal, 14).frame(minHeight: 64)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider().background(Theme.line).padding(.leading, 14)
                }
                if !vm.locked {
                    HStack(spacing: 10) {
                        Button { path.append(.capture(id, s.id)) } label: { Label("Capture", systemImage: "camera") }.secondaryButton()
                        Button { path.append(.sort(id, s.id)) } label: { Text("Review photos") }.primaryButton()
                    }
                    .padding(12)
                }
            }
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(s.complete ? Theme.ok.opacity(0.5) : Theme.line))
    }
}

/// Time since the inspection started, or the total once it was sent to the advisor.
struct InspectionClock: View {
    let startedAt: String?
    let firstSubmittedAt: String?
    var body: some View {
        if let start = parse(startedAt) {
            TimelineView(.periodic(from: .now, by: 30)) { ctx in
                let end = parse(firstSubmittedAt) ?? ctx.date
                let mins = Int(end.timeIntervalSince(start) / 60)
                let text = mins < 60 ? "\(mins) min" : "\(mins / 60) h \(mins % 60) min"
                Text(firstSubmittedAt != nil ? "Inspection time \(text)" : "Started \(start.formatted(date: .omitted, time: .shortened)) · \(text)")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
        }
    }
    private func parse(_ s: String?) -> Date? {
        guard let s else { return nil }
        // The database sends microseconds ("…:00.123456+00:00"); the parser wants none.
        let plain = s.replacingOccurrences(of: "\\.\\d+", with: "", options: .regularExpression).replacingOccurrences(of: " ", with: "T")
        return ISO8601DateFormatter().date(from: plain)
    }
}
