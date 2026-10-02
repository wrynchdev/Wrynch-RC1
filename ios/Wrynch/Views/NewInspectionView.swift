import SwiftUI

struct NewInspectionView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: [Route]
    @State private var f = AppModel.NewInspection()
    @State private var decoded: String?
    @State private var working = false

    private var vinOk: Bool { f.vin.range(of: "^[A-HJ-NPR-Z0-9]{17}$", options: .regularExpression) != nil }

    var body: some View {
        Form {
            Section("Vehicle") {
                HStack {
                    TextField("VIN", text: $f.vin)
                        .font(.body.monospaced()).textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .onChange(of: f.vin) { _, v in
                            let clean = String(v.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(17))
                            if clean != v { f.vin = clean }
                            decoded = nil
                        }
                    Button("Look up") { Task { await lookUp() } }.disabled(!vinOk || working)
                }
                if let decoded { Label(decoded, systemImage: "checkmark.circle").foregroundStyle(Theme.ok) }
                TextField("Year", text: $f.year).keyboardType(.numberPad)
                TextField("Make", text: $f.make)
                TextField("Model", text: $f.model)
                TextField("Trim", text: $f.trim)
                TextField("Engine", text: $f.engine)
            }
            Section("Repair order") {
                TextField("RO number", text: $f.ro)
                TextField("Odometer (mi)", text: $f.odometer).keyboardType(.numberPad)
                TextField("Customer concerns (one per line)", text: $f.concerns, axis: .vertical).lineLimit(2...5)
            }
            Section("Customer") {
                TextField("Name", text: $f.customerName).textContentType(.name)
                TextField("Mobile", text: $f.customerPhone).keyboardType(.phonePad)
                TextField("Email", text: $f.customerEmail).keyboardType(.emailAddress).textInputAutocapitalization(.never)
            }
            Section {
                Button { Task { await create() } } label: {
                    if working { ProgressView().tint(.white) } else { Text("Create and set up vehicle") }
                }
                .primaryButton(vinOk)
                .disabled(!vinOk || working)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.paper)
        .navigationTitle("New inspection")
        .onAppear { if f.config.object?.isEmpty ?? true { f.config = model.blankConfig() } }
    }

    private func lookUp() async {
        working = true
        defer { working = false }
        do {
            let (v, config) = try await model.decodeVin(f.vin)
            f.year = v.year.map(String.init) ?? ""
            f.make = v.make; f.model = v.model; f.trim = v.trim; f.engine = v.engine
            f.config = config
            decoded = "\(f.year) \(v.make) \(v.model)".trimmingCharacters(in: .whitespaces)
        } catch { model.show(error) }
    }

    private func create() async {
        working = true
        defer { working = false }
        do {
            let id = try await model.createInspection(f)
            path.removeLast()
            path.append(.setup(id))
        } catch { model.show(error) }
    }
}

/// What the vehicle has: decides which parts each point checks (parts that aren't on this car are N/A, never "missed").
struct SetupView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @Binding var path: [Route]
    @State private var odometer = ""

    var body: some View {
        Group {
            if let b = model.bundle(id), let vm = model.setup(id) {
                let locked = b.status == "submitted" || b.status == "sent"
                Form {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(b.vehicle["vin"]?.string ?? "").font(.headline.monospaced())
                            Text(vehicleName(b.vehicle)).font(.title3.weight(.bold))
                            if let e = b.vehicle["engine"]?.string, !e.isEmpty { Text(e).font(.footnote).foregroundStyle(Theme.muted) }
                        }
                        HStack {
                            TextField("Odometer (mi)", text: $odometer).keyboardType(.numberPad).font(.body.monospaced())
                            Button("Save") { model.setOdometer(id, Int(odometer.filter(\.isNumber)) ?? 0) }.disabled(locked)
                        }
                    }
                    Section {
                        ForEach(vm.rows) { row in
                            Picker(row.label, selection: Binding(get: { row.value }, set: { v in
                                model.setConfig(id, key: row.key, value: .string(v))
                            })) {
                                ForEach(row.options, id: \.value) { o in Text(o.label).tag(o.value) }
                            }
                            .disabled(locked)
                        }
                    } header: { Text("What this vehicle has") } footer: {
                        Text("Decides which parts each point checks. Parts that aren't on this car become N/A, never “missed”. Check anything the VIN couldn't tell us.")
                    }
                    Section("Also on this vehicle") {
                        ForEach(vm.flags) { flag in
                            Toggle(flag.label, isOn: Binding(get: { flag.on }, set: { model.setConfig(id, key: flag.key, value: .bool($0)) }))
                                .disabled(locked)
                        }
                    }
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(vm.templateName) · \(vm.points) points").font(.footnote).foregroundStyle(Theme.muted)
                            Text("\(vm.applies) parts to rate").font(.title2.weight(.bold))
                            Text("\(vm.na) don't apply to this configuration").font(.footnote).foregroundStyle(Theme.muted)
                        }
                    }
                    Section {
                        Button {
                            model.startInspection(id)
                            path.removeLast()
                            path.append(.inspection(id))
                        } label: { Text(b.status == "not_started" ? "Start inspection" : "Back to inspection") }
                        .primaryButton()
                        .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    }
                }
                .scrollContentBackground(.hidden)
                .onAppear { if odometer.isEmpty, let o = b.inspection["odometer"]?.number, o > 0 { odometer = String(Int(o)) } }
            } else {
                ProgressView()
            }
        }
        .background(Theme.paper)
        .navigationTitle("Set up vehicle")
        .task { if model.bundle(id) == nil { await model.loadInspection(id) } }
    }

    private func vehicleName(_ v: JSONValue) -> String {
        var parts: [String] = []
        if let y = v["year"]?.number { parts.append(String(Int(y))) }
        for k in ["make", "model", "trim"] { if let s = v[k]?.string, !s.isEmpty { parts.append(s) } }
        return parts.joined(separator: " ")
    }
}
