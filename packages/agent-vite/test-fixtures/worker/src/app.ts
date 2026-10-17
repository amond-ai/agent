import { createAgentRouter } from '@amond-ai/agent/routing'
import { Hono } from 'hono'
import { IssueTriage } from './agents/issue-triage.ts'

const app = new Hono()

app.route('/agents/issue-triage', createAgentRouter(IssueTriage))

export default app
