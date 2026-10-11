import SwiftUI

/// One part: AI suggestions to confirm, its checks (measured or rated, with what was found under a Monitor or Immediate
/// rating), "couldn't inspect" right under them, and photos.
struct PartView: View {
    @Environment(AppModel.self) private var model
    let id: String
    let key: String
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
                        if !vm.locked {
                            Button { skipping = true } label: {
                                Label(vm.notInspected.map { "Couldn't inspect: \(Labels.reason($0.reason).lowercased()) · change" } ?? "Couldn't inspect this part",
                                      systemImage: "minus.circle")
                            }
                            .secondaryButton()
                        }
                        if !vm.findings.isEmpty {
                            Text("Other findings").font(.headline)
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
                                            Button(role: .destructive) { model.removeFinding(id, findingId: f.id) } label: { Image(systemName: "trash").frame(width: 48, height: 48) }
                                                .accessibilityLabel("Remove \(f.label)")
                                        }
                                    }
                                }
                            }
                        }
                        Card { Text("**Capture tip:** \(vm.capture)").font(.footnote).foregroundStyle(Theme.muted) }
                    }
                    .padding(16)
                }
                .navigationTitle(vm.title)
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
    @State private var noting = false
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
                    TextField("Value", text: $value).keyboardType(.decimalPad).font(.title3.monospaced()).focused($focused)
                        .frame(maxWidth: 160, minHeight: 44).padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 10))
                        .disabled(locked)
                    Text(check.unit ?? "").foregroundStyle(Theme.muted)
                    Spacer()
                    Button { save() } label: { Text("Save").font(.headline).frame(minWidth: 90, minHeight: 56) }
                        .buttonStyle(.borderedProminent).disabled(locked || Double(value) == nil)
                }
                .onAppear { if value.isEmpty, let v = check.result?.value { value = format(v) } }
            } else {
                HStack(spacing: 8) {
                    ForEach(check.ratings, id: \.self) { r in
                        let on = check.result?.rating == r
                        Button {
                            if on { model.clearCheck(id, key: part, check: check.key) }
                            else { model.setCheck(id, key: part, check: check.key, value: nil, rating: r) }
                        } label: {
                            Text(Labels.state(r)).font(.headline).frame(maxWidth: .infinity, minHeight: 64)
                                .foregroundStyle(on ? Color.black : Theme.color(r))
                                .background(on ? Theme.color(r) : Theme.color(r).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .disabled(locked)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }
            if let r = check.result, !check.findingChoices.isEmpty {
                // Rated OK: noting cosmetic damage is optional, so it stays behind a button until used.
                if r.rating != "ok" || noting || check.findingChoices.contains(where: { $0.on }) {
                    FindingPicker(id: id, part: part, check: check, rating: r.rating, locked: locked)
                } else if !locked {
                    Button("Note existing cosmetic damage") { noting = true }
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
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

/// Under a check rated Monitor or Immediate: tap what you found. AI findings you confirmed show too and stay picked.
private struct FindingPicker: View {
    @Environment(AppModel.self) private var model
    let id: String
    let part: String
    let check: PartVM.Check
    let rating: String
    let locked: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(rating == "ok" ? "Anything to note? (stays OK)" : "What did you find?").font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(check.findingChoices) { c in
                    Button { toggle(c) } label: {
                        HStack(spacing: 4) {
                            if c.ai { Image(systemName: "sparkles").font(.caption) }
                            Text(c.label).font(.subheadline.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.85)
                        }
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .padding(.horizontal, 8)
                        .foregroundStyle(c.on ? (c.ai ? Theme.ai : .white) : Theme.ink)
                        .background(c.on ? (c.ai ? Theme.ai.opacity(0.18) : Theme.blue) : Theme.card, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(c.ai ? Theme.aiLine : Theme.line, style: StrokeStyle(lineWidth: 1, dash: c.ai ? [4, 3] : [])))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(locked || c.ai)
                    .accessibilityAddTraits(c.on ? .isSelected : [])
                }
            }
            if !check.findingChoices.contains(where: { $0.on }) && !locked {
                Text(rating == "ok" ? "Optional: record existing cosmetic damage so it shows in the history and the report." : "Pick what you saw. It goes in the point's summary and the report.").font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .padding(12)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .leading) { Rectangle().fill(Theme.color(rating)).frame(width: 4).clipShape(RoundedRectangle(cornerRadius: 2)) }
    }

    private func toggle(_ c: PartVM.Choice) {
        let mine = check.findingChoices.filter { $0.on && !$0.ai }.map(\.key)
        let next = mine.contains(c.key) ? mine.filter { $0 != c.key } : mine + [c.key]
        model.setCheckFindings(id, key: part, check: check.key, findings: next)
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
                Section("Why couldn't you inspect it?") {
                    ForEach(Labels.reasons, id: \.self) { r in
                        Button { reason = r.key } label: { HStack { Text(r.label); Spacer(); if reason == r.key { Image(systemName: "checkmark") } } }
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
            .navigationTitle("Couldn't inspect")
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
