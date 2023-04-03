import reduct from 'reduct'

import { App } from './services/App'

const app = reduct()(App)
app.init()
