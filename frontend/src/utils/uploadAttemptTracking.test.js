import axios from 'axios';

import {
  flushUploadAttemptEvents,
  getUploadDeviceId,
  recordUploadAttemptEvent,
  uploadErrorDetails,
} from './uploadAttemptTracking';


jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

describe('upload attempt tracking', () => {
  beforeEach(() => {
    localStorage.clear();
    axios.post.mockReset();
  });

  test('reuses the diagnostics device id and sends metadata only', async () => {
    localStorage.setItem('pastasciutta_device_id', 'device-cassa-1');
    axios.post.mockResolvedValue({ data: { ok: true } });

    await recordUploadAttemptEvent('token', {
      attempt_id: 'attempt-1',
      stage: 'file_selected',
      upload_kind: 'closure_primary',
      file_size_bytes: 2048,
    }, 'rest-1');

    expect(getUploadDeviceId()).toBe('device-cassa-1');
    expect(axios.post).toHaveBeenCalledTimes(1);
    const payload = axios.post.mock.calls[0][1];
    expect(payload).toMatchObject({
      attempt_id: 'attempt-1',
      stage: 'file_selected',
      device_id: 'device-cassa-1',
      file_size_bytes: 2048,
    });
    expect(payload.event_id).toBeTruthy();
    expect(payload.client_at).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain('image_data');
  });

  test('queues a failed diagnostic event and flushes it later for the same locale', async () => {
    axios.post.mockRejectedValueOnce(new Error('offline'));
    const sent = await recordUploadAttemptEvent('token', {
      attempt_id: 'attempt-2',
      stage: 'upload_failed',
    }, 'rest-1');
    expect(sent).toBe(false);
    expect(localStorage.getItem('pastasciutta_upload_attempt_queue_v1')).toContain('attempt-2');

    axios.post.mockResolvedValueOnce({ data: { ok: true } });
    await flushUploadAttemptEvents('token', 'rest-1');

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('pastasciutta_upload_attempt_queue_v1')).toBe('[]');
  });

  test('classifies timeout errors without exposing them to the cashier UI', () => {
    expect(uploadErrorDetails({ code: 'ECONNABORTED', message: 'timeout' })).toEqual({
      error_kind: 'timeout',
      error_message: 'Timeout della richiesta',
    });
  });
});
