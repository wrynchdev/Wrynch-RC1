// A stand-in for Tekmetric's API for the browser test: OAuth client credentials and the read endpoints Wrynch uses.
import http from 'node:http';
const port = Number(process.env.TM_PORT ?? 54331);
const RO = { id: 55, repairOrderNumber: 10421, shopId: 238, vehicleId: 9, customerId: 7, technicianId: 3, milesIn: 88120, customerConcerns: [{ concern: 'Squeal when braking' }] };
const data = {
  '/api/v1/repair-orders/55': RO,
  '/api/v1/vehicles/9': { id: 9, vin: '1HGCM82633A004352', year: 2003, make: 'Honda', model: 'Accord', subModel: 'EX' },
  '/api/v1/customers/7': { id: 7, firstName: 'Pat', lastName: 'Lee', email: 'pat@example.com', phone: [{ number: '555-0111', primary: true }] },
  '/api/v1/employees/3': { id: 3, firstName: 'Ray', lastName: 'K.' },
};
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'POST' && url.pathname === '/api/v1/oauth/token') {
    return req.headers.authorization === `Basic ${Buffer.from('e2e:e2e').toString('base64')}` ? send(200, { access_token: 'tm-e2e', expires_in: 3600 }) : send(401, {});
  }
  if (req.headers.authorization !== 'Bearer tm-e2e') return send(401, {});
  if (url.searchParams.get('shop') !== '238') return send(403, {});
  if (url.pathname === '/api/v1/repair-orders') return send(200, { content: url.searchParams.get('repairOrderNumber') === '10421' ? [RO] : [] });
  return data[url.pathname] ? send(200, data[url.pathname]) : send(404, {});
}).listen(port, () => console.log(`fake Tekmetric on http://localhost:${port}`));
