import 'dotenv/config';
import http from 'node:http';
import app from './src/app.js';

const port = Number(process.env.PORT ?? 4000);

const server = http.createServer(app);

server.listen(port, () => {
  console.log(`AutoFlow server running on http://localhost:${port}`);
});
