import SwiftUI
import WebKit

/// Owns the WKWebView, installs the localStorage<->file bridge, and handles
/// file open/save panels for import/export.
final class WebController: NSObject, ObservableObject,
                           WKScriptMessageHandler, WKUIDelegate,
                           WKNavigationDelegate, WKDownloadDelegate {
    let webView: WKWebView
    /// Retained explicitly — `webView.configuration` returns a *copy*, so the
    /// web view only ever sees scripts/handlers added to this instance.
    private let contentController = WKUserContentController()

    override init() {
        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        contentController.add(self, name: "store")
        webView.uiDelegate = self
        webView.navigationDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        loadApp()
    }

    private var webRoot: URL { Bundle.main.url(forResource: "web", withExtension: nil)! }

    /// (Re)install the bridge with the latest on-disk data, then load index.html.
    func loadApp() {
        installBridge()
        let index = webRoot.appendingPathComponent("index.html")
        webView.loadFileURL(index, allowingReadAccessTo: webRoot)
    }

    func reloadFromDisk() { loadApp() }

    // MARK: - localStorage bridge

    private func installBridge() {
        let ucc = contentController
        ucc.removeAllUserScripts()

        let seed: String
        if let json = Store.read(), let literal = jsStringLiteral(json) {
            seed = literal
        } else {
            seed = "null"
        }

        // Runs before app.js: seeds localStorage from the file, and mirrors
        // every write of the app's key back to the native side.
        // Runs before app.js at document start. Seeds localStorage from the
        // data file, then patches Storage.prototype.setItem so every write of
        // the app's key is mirrored to the native side. (Patching the prototype
        // — not the instance — is required: WebKit's Storage object treats
        // instance property assignment as a stored value, not a method override.)
        let source = """
        (function () {
          var KEY = "\(Store.storageKey)";
          var SEED = \(seed);
          function post(v){ try { window.webkit.messageHandlers.store.postMessage(v); } catch (e) {} }
          try { if (SEED !== null) localStorage.setItem(KEY, SEED); } catch (e) {}
          try {
            var proto = window.Storage && window.Storage.prototype;
            if (proto && !proto.__wpPatched) {
              var _set = proto.setItem;
              proto.setItem = function (k, v) { if (k === KEY) post(v); return _set.apply(this, arguments); };
              proto.__wpPatched = true;
            }
          } catch (e) {}
        })();
        """
        ucc.addUserScript(WKUserScript(source: source,
                                       injectionTime: .atDocumentStart,
                                       forMainFrameOnly: false))
    }

    /// Encode a Swift string as a safe JS string literal (JSON strings are valid JS).
    private func jsStringLiteral(_ s: String) -> String? {
        guard let data = try? JSONEncoder().encode(s) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "store", let body = message.body as? String else { return }
        Store.write(body)
    }

    // MARK: - Native backup actions (menu)

    func exportBackup() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "work-planner-backup.json"
        panel.allowedContentTypes = [.json]
        panel.begin { resp in
            guard resp == .OK, let url = panel.url else { return }
            try? Store.exportTo(url)
        }
    }

    func importBackup() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.json]
        panel.begin { [weak self] resp in
            guard resp == .OK, let url = panel.url else { return }
            do { try Store.importFrom(url); self?.loadApp() }
            catch { NSSound.beep() }
        }
    }

    func revealData() {
        NSWorkspace.shared.activateFileViewerSelecting([Store.dataFile])
    }

    // MARK: - File input (in-app import button)

    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.begin { resp in completionHandler(resp == .OK ? panel.urls : nil) }
    }

    // MARK: - Downloads (in-app export button uses a blob <a download>)

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView,
                 navigationAction: WKNavigationAction,
                 didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView,
                 navigationResponse: WKNavigationResponse,
                 didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename.isEmpty ? "work-planner-backup.json" : suggestedFilename
        panel.begin { resp in
            guard resp == .OK, let url = panel.url else { completionHandler(nil); return }
            try? FileManager.default.removeItem(at: url)
            completionHandler(url)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {}
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {}
}

/// SwiftUI wrapper that hosts the controller's WKWebView.
struct WebView: NSViewRepresentable {
    @ObservedObject var controller: WebController
    func makeNSView(context: Context) -> WKWebView { controller.webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
