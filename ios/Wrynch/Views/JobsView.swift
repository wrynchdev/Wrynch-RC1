import SwiftUI

/// Today's inspections: open ones first, then today's finished ones.
struct JobsView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: [Route]

    private var jobs: [JobHeader] {
        let today = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
        return model.jobs.filter { $0.status != "sent" || $0.date == today }
    }

    var body: some View {
        List {
            Section {
                Button { path.append(.newInspection) } label: { Label("New inspection", systemImage: "plus") }
                    .primaryButton()
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if jobs.isEmpty {
                Text("No open inspections. Start one with the button above.").foregroundStyle(Theme.muted).listRowBackground(Theme.card)
            }
            ForEach(jobs) { j in
                Button { open(j) } label: { JobRow(job: j) }
                    .listRowBackground(Theme.card)
            }
            Section {
                Text("Advisor review, customer reports and shop settings are on the web at wrynch.app.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            .listRowBackground(Color.clear)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.paper)
        .navigationTitle("Today")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if model.shops.count > 1 {
                        Section("Shop") {
                            ForEach(model.shops) { s in
                                Button { Task { await model.loadWorkspace(shop: s.id) } } label: {
                                    if s.id == model.shopId { Label(s.name, systemImage: "checkmark") } else { Text(s.name) }
                                }
                            }
                        }
                    }
                    Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                } label: { Label(model.myName.isEmpty ? "Account" : model.myName, systemImage: "person.crop.circle") }
            }
        }
        .refreshable { await model.loadWorkspace() }
    }

    private func open(_ j: JobHeader) {
        switch j.status {
        case "not_started": path.append(.setup(j.id))
        case "in_progress": path.append(.inspection(j.id))
        default: path.append(.inspection(j.id))
        }
    }
}

private struct JobRow: View {
    let job: JobHeader
    private var details: String {
        var parts: [String] = []
        if let o = job.odometer { parts.append("\(o.formatted()) mi") }
        if let c = job.vehicle.customer, !c.isEmpty { parts.append(c) }
        if let t = job.technician, !t.isEmpty { parts.append(t) }
        return parts.joined(separator: " · ")
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(job.ro.isEmpty ? job.date : "RO \(job.ro)").font(.caption.monospaced()).foregroundStyle(Theme.muted)
                Spacer()
                Text(Labels.jobStatus[job.status] ?? job.status).font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background((job.status == "in_progress" ? Theme.na : Theme.blue).opacity(0.18), in: Capsule())
            }
            Text(job.vehicle.name).font(.title3.weight(.bold))
            Text(details).font(.footnote).foregroundStyle(Theme.muted)
            if let c = job.concerns, !c.isEmpty { Text("Concern: \(c.joined(separator: ", "))").font(.footnote) }
            if let s = job.summary, job.status != "not_started" {
                HStack(spacing: 12) {
                    Text("\(s.immediate) immediate").foregroundStyle(Theme.immediate)
                    Text("\(s.monitor) monitor").foregroundStyle(Theme.monitor)
                }.font(.footnote.weight(.bold))
            }
            if let n = job.pendingAi, n > 0 { AiChip(text: "\(n) AI items to review") }
        }
        .foregroundStyle(Theme.ink)
        .padding(.vertical, 4)
    }
}
