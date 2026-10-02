import SwiftUI

@main
struct WrynchApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Theme.blue)
        }
    }
}

/// Screens a technician moves between.
enum Route: Hashable {
    case newInspection
    case setup(String)
    case inspection(String)
    case point(String, String)
    case part(String, String)
    case sort(String, String)
    case capture(String, String)
    case finish(String)
    case wording(String, String)
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var path: [Route] = []

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.paper.ignoresSafeArea()
            if model.starting {
                ProgressView().tint(Theme.ink)
            } else if !model.signedIn {
                SignInView()
            } else {
                NavigationStack(path: $path) {
                    JobsView(path: $path)
                        .navigationDestination(for: Route.self) { route in destination(route) }
                }
            }
            if let busy = model.busy {
                HStack(spacing: 10) { ProgressView().tint(Theme.ink); Text(busy).font(.subheadline.weight(.semibold)) }
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Theme.card2, in: Capsule())
                    .padding(.bottom, 90)
                    .accessibilityElement(children: .combine)
            }
        }
        .foregroundStyle(Theme.ink)
        .task { await model.start() }
        .alert(model.message?.error == true ? "Something went wrong" : "Wrynch",
               isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) {
            Button("OK", role: .cancel) { model.message = nil }
        } message: { Text(model.message?.text ?? "") }
    }

    @ViewBuilder private func destination(_ r: Route) -> some View {
        switch r {
        case .newInspection: NewInspectionView(path: $path)
        case .setup(let id): SetupView(id: id, path: $path)
        case .inspection(let id): OverviewView(id: id, path: $path)
        case .point(let id, let p): PointView(id: id, pointId: p, path: $path)
        case .part(let id, let k): PartView(id: id, key: k)
        case .sort(let id, let s): SortView(id: id, stageId: s, path: $path)
        case .capture(let id, let s): CaptureView(id: id, stageId: s, path: $path)
        case .finish(let id): FinishView(id: id, path: $path)
        case .wording(let id, let p): WordingView(id: id, pointId: p)
        }
    }
}
