import SwiftUI

struct ContentView: View {
    @ObservedObject var controller: WebController

    var body: some View {
        WebView(controller: controller)
            .ignoresSafeArea()
            .frame(minWidth: 880, minHeight: 600)
    }
}
