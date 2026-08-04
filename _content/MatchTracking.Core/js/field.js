// Restituisce le coordinate del click nel sistema viewBox dell'SVG, normalizzate 0..1.
export function toNormalizedPoint(svgElement, clientX, clientY) {
    if (!svgElement || !svgElement.getScreenCTM) return null;
    const pt = svgElement.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgElement.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    const vb = svgElement.viewBox.baseVal;
    if (!vb || vb.width === 0 || vb.height === 0) return null;
    return {
        x: (local.x - vb.x) / vb.width,
        y: (local.y - vb.y) / vb.height
    };
}
