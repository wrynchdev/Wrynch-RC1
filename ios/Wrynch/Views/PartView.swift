import SwiftUI

/// One part: AI suggestions to confirm, its checks (measured or rated), findings, photos, and "couldn't check".
struct PartView: View {
    @Environment(AppModel.self) private var model
    let id: String
    let key: String
    @State private var adding = false
    @State private var skipping = false

    var body: some View {
        Group {
            if let vm = model.part(id, key) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(vm.subtitle).font(.footnote).foregroundStyle(Theme.muted)
                        HStack {
                            StateChip(state: vm.state, large: true)
                            Spacer()
                            if let n = vm.notInspected { Text(Labels.reason(n.reason)).font(.footnote).foregroundStyle(Theme.muted) }
                        }
                        ForEach(vm.pendingFindings) { f in AiFindingCard(id: id, finding: f, options: vm.findingOptions, locked: vm.locked) }
                        if let ok = vm.looksOk {
                            AiBox {
                                Text("AI: looks OK in \(ok.ids.count == 1 ? "the photo" : "\(ok.ids.count) photos")\(ok.note.map { " · \($0)" } ?? "")\(ok.confidence.map { " · \(Int($0 * 100))% sure" } ?? "")")
                                    .font(.footnote)
                                if !vm.locked {
                                    HStack {
                                        Button("Confirm OK") { model.reviewLooksOk(id, ids: ok.ids, confirm: true) }.primaryButton()
                                        Button("Not right") { model.reviewLooksOk(id, ids: ok.ids, confirm: false) }.secondaryButton().frame(maxWidth: 120)
                                    }
                                }
                            }
                        }
                        if !vm.photos.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 10) { ForEach(vm.photos) { PhotoThumb(path: $0.path, size: 120, pending: $0.pending) } }
                            }
                        }
                        Text("Checks").font(.headline)
                        ForEach(vm.checks) { c in CheckCard(id: id, part: key, check: c, locked: vm.locked) }
                        HStack {
                            Text("Findings").font(.headline)
                            Spacer()
                            if !vm.locked { Button("+ Add finding") { adding = true } }
                        }
                        if vm.findings.isEmpty { Text("None recorded.").font(.footnote).foregroundStyle(Theme.muted) }
                        ForEach(vm.findings) { f in
                            Card {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(f.label).font(.subheadline.weight(.semibold))
                                        Text("\(f.severity.capitalized) · \(f.source == "ai" ? "AI, \(f.status == "modified" ? "edited" : "confirmed") by you" : "Entered by you")")
                                            .font(.caption).foregroundStyle(Theme.muted)
                                    }
                                    Spacer()
                                    StateChip(state: f.rating)
                                    if !vm.locked && f.removable {
                                        Button(role: .destructive) { model.removeFinding(id, findingId: f.id) } label: { Image(systemName: "trash") }
                                            .accessibilityLabel("Remove \(f.label)")
                                    }
                                }
                            }
                        }
                        Card { Text("**Capture tip:** \(vm.capture)").font(.footnote).foregroundStyle(Theme.muted) }
                        if !vm.locked { Button("Couldn't check this part") { skipping = true }.secondaryButton() }
                    }
                    .padding(16)
                }
                .navigationTitle(vm.title)
                .sheet(isPresented: $adding) { AddFindingSheet(id: id, part: key, options: vm.findingOptions) }
                .sheet(isPresented: $skipping) { SkipSheet(id: id, part: key, current: vm.notInspected) }
            } else {
                ProgressView()
            }
        }
        .background(Theme.paper)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if model.saving.contains(id) { ToolbarItem(placement: .topBarTrailing) { ProgressView() } } }
    }
}

private struct CheckCard: View {
    @Environment(AppModel.self) private var model
    let id: String
    let part: String
    let check: PartVM.Check
    let locked: Bool
    @State private var value = ""
    @State private var showBands = false
    @FocusState private var focused: Bool

    var body: some View {
        Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(check.name).font(.subheadline.weight(.bold))
                    Text(check.how).font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer()
                if let r = check.result { StateChip(state: r.rating) }
            }
            if check.measured {
                HStack {
                    TextField("Value", text: $value).keyboardType(.decimalPad).font(.body.monospaced()).focused($focused)
                        .frame(maxWidth: 140).padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 10))
                        .disabled(locked)
                    Text(check.unit ?? "").foregroundStyle(Theme.muted)
                    Spacer()
                    Button("Save") { save() }.buttonStyle(.borderedProminent).disabled(locked || Double(value) == nil)
                }
                .onAppear { if value.isEmpty, let v = check.result?.value { value = format(v) } }
            } else {
                HStack(spacing: 6) {
                    ForEach(check.ratings, id: \.self) { r in
                        let on = check.result?.rating == r
                        Button {
                            if on { model.clearCheck(id, key: part, check: check.key) }
                            else { model.setCheck(id, key: part, check: check.key, value: nil, rating: r) }
                        } label: {
                            Text(Labels.state(r)).font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 40)
                                .foregroundStyle(on ? Color.black : Theme.color(r))
                                .background(on ? Theme.color(r) : Theme.color(r).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .disabled(locked)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }
            DisclosureGroup("What counts as OK / Monitor / Immediate", isExpanded: $showBands) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("**OK:** \(check.bands.ok)")
                    if let m = check.bands.monitor { Text("**Monitor:** \(m)") }
                    if let i = check.bands.immediate { Text("**Immediate:** \(i)") }
                    Text("Basis: \(check.basis)").foregroundStyle(Theme.muted)
                }
                .font(.caption).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
            }
            .font(.caption).tint(Theme.muted)
        }
    }

    private func save() {
        guard let v = Double(value.replacingOccurrences(of: ",", with: ".")) else { return }
        focused = false
        model.setCheck(id, key: part, check: check.key, value: v, rating: nil)
    }
    private func format(_ v: Double) -> String { v.rounded() == v ? String(Int(v)) : String(v) }
}

private struct AiFindingCard: View {
    @Environment(AppModel.self) private var model
    let id: String
    let finding: PartVM.PendingFinding
    let options: [PartVM.FindingOption]
    let locked: Bool
    @State private var editing = false
    @State private var key = ""
    @State private var severity = ""

    var body: some View {
        AiBox {
            HStack {
                Label("AI suggests", systemImage: "sparkles").font(.subheadline.weight(.bold)).foregroundStyle(Theme.ai)
                Spacer()
                if let c = finding.confidence { Text("\(Int(c * 100))% sure").font(.caption).foregroundStyle(Theme.muted) }
            }
            if let p = finding.photoPath { PhotoThumb(path: p, size: 160) }
            HStack(alignment: .top) {
                VStack(alignment: .leading) { Text("Finding").font(.caption).foregroundStyle(Theme.muted); Text(label).font(.subheadline.weight(.bold)) }
                Spacer()
                VStack(alignment: .leading) { Text("Severity").font(.caption).foregroundStyle(Theme.muted); Text((editing ? severity : finding.severity).capitalized).font(.subheadline.weight(.bold)) }
                Spacer()
                VStack(alignment: .leading) { Text("Rating").font(.caption).foregroundStyle(Theme.muted); StateChip(state: rating) }
            }
            if let r = finding.rationale, !r.isEmpty { Text(r).font(.footnote).foregroundStyle(Theme.muted) }
            if editing {
                Picker("Finding", selection: $key) { ForEach(options) { Text($0.label).tag($0.key) } }
                Picker("Severity", selection: $severity) { ForEach(Labels.severities, id: \.self) { Text($0.capitalized).tag($0) } }.pickerStyle(.segmented)
            }
            if !locked {
                Text("Until you confirm, this doesn't count and the customer can't see it.").font(.caption).foregroundStyle(Theme.muted)
                HStack {
                    Button("Reject", role: .destructive) { model.reviewFinding(id, findingId: finding.id, action: "reject") }.buttonStyle(.bordered)
                    if editing {
                        Button("Save and confirm") {
                            if key == finding.key && severity == finding.severity { model.reviewFinding(id, findingId: finding.id, action: "confirm") }
                            else { model.reviewFinding(id, findingId: finding.id, action: "modify", key: key, severity: severity) }
                        }.primaryButton()
                    } else {
                        Button("Edit") { key = finding.key; severity = finding.severity; editing = true }.buttonStyle(.bordered)
                        Button("Confirm") { model.reviewFinding(id, findingId: finding.id, action: "confirm") }.primaryButton()
                    }
                }
            }
        }
    }
    private var label: String { editing ? (options.first { $0.key == key }?.label ?? finding.label) : finding.label }
    private var rating: String { editing ? (options.first { $0.key == key }?.ratings[severity] ?? finding.rating) : finding.rating }
}

private struct AddFindingSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    let part: String
    let options: [PartVM.FindingOption]
    @State private var key: String?
    @State private var severity = "moderate"

    var body: some View {
        NavigationStack {
            Form {
                Section("Finding") {
                    ForEach(options) { o in
                        Button { key = o.key } label: { HStack { Text(o.label); Spacer(); if key == o.key { Image(systemName: "checkmark") } } }
                    }
                }
                Section("Severity") {
                    Picker("Severity", selection: $severity) { ForEach(Labels.severities, id: \.self) { Text($0.capitalized).tag($0) } }.pickerStyle(.segmented)
                    if let k = key, let r = options.first(where: { $0.key == k })?.ratings[severity] { HStack { Text("Default rating"); Spacer(); StateChip(state: r) } }
                }
            }
            .navigationTitle("Add finding")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { if let key { model.addFinding(id, key: part, finding: key, severity: severity) }; dismiss() }.disabled(key == nil)
                }
            }
        }
    }
}

private struct SkipSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    let part: String
    let current: PartVM.NotInspected?
    @State private var reason: String?
    @State private var kind = "not_inspected"

    var body: some View {
        NavigationStack {
            Form {
                Section("Why couldn't you check it?") {
                    ForEach(Labels.reasons, id: \.0) { r in
                        Button { reason = r.0 } label: { HStack { Text(r.1); Spacer(); if reason == r.0 { Image(systemName: "checkmark") } } }
                    }
                }
                Section {
                    Picker("Record as", selection: $kind) {
                        Text("Not inspected").tag("not_inspected")
                        Text("Unable to assess").tag("unable_to_assess")
                    }.pickerStyle(.segmented)
                } footer: { Text("The customer sees the reason, not a blank. Any ratings on this part are cleared.") }
                if current != nil {
                    Button("Clear", role: .destructive) { model.setNotInspected(id, key: part, kind: nil, reason: nil); dismiss() }
                }
            }
            .navigationTitle("Couldn't check")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { model.setNotInspected(id, key: part, kind: kind, reason: reason); dismiss() }.disabled(reason == nil)
                }
            }
            .onAppear { reason = current?.reason; kind = current?.kind ?? "not_inspected" }
        }
    }
}
