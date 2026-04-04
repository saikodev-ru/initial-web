/**
 * link-qr-renderer.js — Standalone QR renderer for Link Device modal
 *
 * Uses QRCodeStyling (loaded from CDN in index.html) but renders as canvas
 * instead of SVG for reliable sizing within the modal container.
 *
 * Usage:
 *   renderLinkQR(containerElement, "https://example.com/link", 240);
 */

window.renderLinkQR = function (container, url, size) {
  if (!container || !url) return;

  size = size || 240;

  // Clear any previous content
  container.innerHTML = '';

  try {
    var qr = new QRCodeStyling({
      width: size,
      height: size,
      type: "canvas",           // canvas — avoids SVG sizing quirks
      data: url,
      dotsOptions: {
        color: "#000000",
        type: "extra-rounded"
      },
      backgroundOptions: {
        color: "#ffffff"
      },
      cornersSquareOptions: {
        type: "extra-rounded"
      },
      cornersDotOptions: {
        type: "dot"
      },
      qrOptions: {
        errorCorrectionLevel: "M"
      }
    });

    // Append — QRCodeStyling creates a <canvas> inside the container
    qr.append(container);

    // Make the canvas fill the container precisely with rounded corners
    var canvas = container.querySelector("canvas");
    if (canvas) {
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.borderRadius = "16px";
    }
  } catch (e) {
    // Graceful fallback: display the URL as plain text
    container.innerHTML =
      '<div style="' +
      "font-size:10px;" +
      "word-break:break-all;" +
      "opacity:0.5;" +
      "padding:12px;" +
      "text-align:center;" +
      '">' +
      url +
      "</div>";
  }
};
