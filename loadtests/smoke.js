import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 5,
  duration: '10s',
  thresholds: { http_req_failed: ['rate<0.005'], http_req_duration: ['p(95)<500'] },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL || 'http://localhost'}/api/ready`);
  check(res, { 'ready 200': (r) => r.status === 200 });
}
