import { ALERT_CATEGORY } from '../modules/audit/security-alerts.service';
import { OPS_ALERT_KINDS, OpsAlertUsageError, parseOpsAlertArgs } from './ops-alert';

/* The ops-alert command's arguments (LAUNCH-PLAN §6, L10): ops kinds only, numeric details only. */

describe('ops-alert arguments', () => {
  it('take an ops kind and numeric key=value details', () => {
    expect(
      parseOpsAlertArgs([
        '--kind',
        'ops.backup_failed',
        '--meta',
        'step=5',
        '--meta',
        'ratio=0.25',
        '--meta',
        'delta=-3',
      ]),
    ).toEqual({ kind: 'ops.backup_failed', meta: { step: 5, ratio: 0.25, delta: -3 } });
    expect(parseOpsAlertArgs(['--kind', 'ops.alert_test'])).toEqual({
      kind: 'ops.alert_test',
      meta: {},
    });
  });

  it('allow only three ops kinds: no forged security, payments or check alert', () => {
    for (const kind of OPS_ALERT_KINDS) expect(ALERT_CATEGORY[kind]).toBe('ops');
    expect([...OPS_ALERT_KINDS].sort()).toEqual([
      'ops.alert_test',
      'ops.backup_failed',
      'ops.monitor_failed',
    ]);
    for (const kind of [
      'login.account_limit',
      'payments.needs_review',
      'ops.nope',
      'ops.disk',
      'OPS.ALERT_TEST',
    ])
      expect(() => parseOpsAlertArgs(['--kind', kind])).toThrow(OpsAlertUsageError);
  });

  it('refuse text, bad keys, too many details, a missing kind and unknown arguments', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ['--meta', `k${i}=1`]).flat();
    for (const argv of [
      ['--kind', 'ops.alert_test', '--meta', 'step=five'],
      ['--kind', 'ops.alert_test', '--meta', 'step=1e3'],
      ['--kind', 'ops.alert_test', '--meta', 'Step=1'],
      ['--kind', 'ops.alert_test', '--meta', '=1'],
      ['--kind', 'ops.alert_test', '--meta', 'novalue'],
      ['--kind', 'ops.alert_test', '--meta'],
      ['--kind', 'ops.alert_test', ...tooMany],
      ['--kind'],
      ['--kind', 'ops.alert_test', '--email', 'x'],
      [],
    ])
      expect(() => parseOpsAlertArgs(argv)).toThrow(OpsAlertUsageError);
  });
});
