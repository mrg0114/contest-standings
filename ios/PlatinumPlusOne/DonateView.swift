import SwiftUI

/// The Donate tab. A placeholder until there is a charity to give to.
struct DonateView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Image(systemName: "heart.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color(red: 0x4a / 255, green: 0x15 / 255, blue: 0x26 / 255))
                Text("Giving back").font(.title2.weight(.bold))
                Text("We may add a way to donate to charity in support of the contest. Check back here.")
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .padding(32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color("PageBackground"))
            .navigationTitle("Donate")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
