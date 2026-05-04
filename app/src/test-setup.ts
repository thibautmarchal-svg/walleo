// Polyfill IndexedDB with an in-memory implementation so Dexie works in jsdom.
import 'fake-indexeddb/auto'

// jest-dom matchers for Testing Library assertions.
import '@testing-library/jest-dom'
