import express from 'express';
import bodyParser from 'body-parser';
import { createJob } from './api/jobs/createJob';
import { getJob } from './api/jobs/getJob';

const app = express();
app.use(bodyParser.json());

app.post('/jobs', async (req, res) => {
  try {
    const result = await createJob({
      headers: {
        'x-correlation-id': req.header('x-correlation-id') || `local-${Date.now()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body),
    } as any);
    res.status((result as any).statusCode || 201).send((result as any).body);
  } catch (err: any) {
    res.status(500).send(JSON.stringify({ error: err?.message || 'Internal error' }));
  }
});

app.get('/jobs/:jobId', async (req, res) => {
  try {
    const result = await getJob({
      headers: {
        'x-correlation-id': req.header('x-correlation-id') || `local-${Date.now()}`,
      },
      pathParameters: { jobId: req.params.jobId },
      queryStringParameters: { tenantId: String(req.query.tenantId || '') },
    } as any);
    res.status((result as any).statusCode || 200).send((result as any).body);
  } catch (err: any) {
    res.status(500).send(JSON.stringify({ error: err?.message || 'Internal error' }));
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`);
});


