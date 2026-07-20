import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Component tests need a DOM. Registered globally here and preloaded via
// `bunfig.toml`, so the test files themselves stay about behaviour.
GlobalRegistrator.register()
