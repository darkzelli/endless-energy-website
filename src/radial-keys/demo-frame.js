// A live demo of the app (demo.html: its real UI on bridge.js) in an iframe, scaled so the rings
// on show fill `stage`. The page's hero uses one, and so does the preset preview.
// `onMessage` gets the frame's other messages ({ type: 'touched' | 'tour' | 'ready', … }).
const frames = new Map() // frame window -> demo

window.addEventListener('message', (e) => {
  const demo = frames.get(e.source)
  if (e.origin !== location.origin || !demo) return
  if (e.data.type === 'layout') {
    demo.wheelSize = e.data.size
    demo.fit()
  } else {
    demo.onMessage?.(e.data)
  }
})

export function mountDemo(stage, frame, { maxScale = 1.8, onMessage } = {}) {
  const demo = {
    wheelSize: 580,
    onMessage,
    post: (data) => frame.contentWindow?.postMessage(data, location.origin),
    fit() {
      const width = stage.clientWidth
      if (!width) return // hidden
      const scale = Math.min(maxScale, width / (demo.wheelSize + 32)) // the 32: room for the message box
      frame.style.transform = `translate(-50%, -50%) scale(${scale})`
      demo.post({ type: 'fit', visible: width / scale, scale })
    },
  }
  const register = () => {
    frames.set(frame.contentWindow, demo)
    demo.fit()
  }
  frame.addEventListener('load', register)
  if (frame.contentWindow) frames.set(frame.contentWindow, demo)
  new ResizeObserver(() => demo.fit()).observe(stage)
  // The tour holds still while it's out of sight.
  new IntersectionObserver(([e]) => demo.post({ type: 'visible', on: e.isIntersecting })).observe(stage)
  return demo
}
