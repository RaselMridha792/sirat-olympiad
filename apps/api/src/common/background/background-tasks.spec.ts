import { Logger } from '@nestjs/common';
import { BackgroundTasks } from './background-tasks';

describe('BackgroundTasks', () => {
  afterEach(() => jest.restoreAllMocks());

  it('runs work without the caller waiting, and idle() waits for it', async () => {
    const tasks = new BackgroundTasks();
    let done = false;
    tasks.run('t', async () => {
      await new Promise((r) => setTimeout(r, 30));
      done = true;
    });
    expect(done).toBe(false);
    await tasks.idle();
    expect(done).toBe(true);
  });

  it('logs a failure by class only, never its message, and never throws to the caller', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const tasks = new BackgroundTasks();
    expect(() =>
      tasks.run('send', async () => {
        throw new Error('could not reach student@example.com');
      }),
    ).not.toThrow();
    await tasks.idle();
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('background task failed');
    expect(logged).toContain('"task":"send"');
    expect(logged).not.toContain('student@example.com');
  });
});
