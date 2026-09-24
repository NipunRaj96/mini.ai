import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement scrollIntoView -- MessageStream calls it to keep
// the view pinned to the latest message as it streams in.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})
