import SwiftUI

/// Finish: what still needs the technician, how the report notes get written, and Send to advisor.
struct FinishView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @Binding var path: [Route]
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
                        Card {
                            Label("Report notes", systemImage: "text.alignleft").font(.headline)
                            Text("\(vm.pointsWithNote) of \(vm.pointCount) points have your note. The AI writes a customer-friendly summary of the findings for the rest, so no point is blank. The service advisor approves or edits every note before the report goes to the customer.")
                                .font(.footnote).foregroundStyle(Theme.muted)
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
            } else {
                ProgressView()
            }
        }
        .background(Theme.paper)
        .navigationTitle("Finish inspection")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadInspection(id) }
    }

    private func open(_ item: FinishVM.Item) {
        if let k = item.partKey { path.append(.part(id, k)) }
        else if let s = item.stageId { path.append(.sort(id, s)) }
    }
}
