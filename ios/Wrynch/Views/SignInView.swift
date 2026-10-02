import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var password = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("WRYNCH").font(.system(size: 40, weight: .black)).tracking(2).padding(.top, 60)
                Text("Sign in with your Wrynch account. Shops join through the pilot at getwrynch.com.")
                    .font(.subheadline).foregroundStyle(Theme.muted)
                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.immediate) }
                Button {
                    Task {
                        working = true; error = nil
                        do { try await model.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password) }
                        catch { self.error = error.localizedDescription }
                        working = false
                    }
                } label: {
                    if working { ProgressView().tint(.white) } else { Text("Sign in") }
                }
                .primaryButton(!email.isEmpty && !password.isEmpty)
                .disabled(email.isEmpty || password.isEmpty || working)
                Button("Forgot your password?") {
                    Task {
                        do { try await model.api.resetPassword(email: email); model.show("If that email has an account, a reset link is on its way.") }
                        catch { model.show(error) }
                    }
                }
                .font(.footnote).disabled(email.isEmpty)
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}
