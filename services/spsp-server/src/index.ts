import reduct from 'reduct'
import * as dotenv from 'dotenv'

import { App } from './services/App'

dotenv.load({ path: '.env' })
const container = reduct()
const app = container(App)
app.start()
