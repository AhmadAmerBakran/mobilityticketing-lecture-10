# Lecture 10 evidence

These are test notices in MongoDB, not cancellations of real departures. PostgreSQL remains responsible for timetables and bookings. I used the supplied Docker Compose setup and kept a separate request ID for each write. The experiments run on a GitHub Actions Linux runner.

The full run is [here](https://github.com/AhmadAmerBakran/mobilityticketing-lecture-10/actions/runs/43717987600), with the original JSON results in [the run artifact](https://github.com/AhmadAmerBakran/mobilityticketing-lecture-10/actions/runs/43717987600/artifacts/14163645964). The relevant responses are also committed in `docs/results` so they remain available with this work.

## Experiments

Before starting, I expected a majority write to need two acknowledgements out of three and a write with `w: 1` to need only the primary. A write with `w: 3` needs all three members. The service names are fixed, but I check the member states instead of assuming which one is primary.

| Situation | Command | Prediction | Observed |
| --- | --- | --- | --- |
| Three members | `write BASE-MAJ majority` | Acknowledged by a majority | Acknowledged ([JSON](results/baseline_majority.json)) |
| Three members | `write BASE-ONE 1` | Acknowledged by primary | Acknowledged ([JSON](results/baseline_one.json)) |
| Three members | `read BASE-MAJ primary` | Present | Present; T102 / Cancelled / 2 ([JSON](results/baseline_primary_read.json)) |
| Three members | `read BASE-MAJ secondary` | Present if replication has caught up | Present; T102 / Cancelled / 2 ([JSON](results/baseline_secondary_read.json)) |
| First primary stopped | `read BASE-MAJ secondary` | Present from a remaining secondary | Present ([JSON](results/stopped_primary_read.json)) |
| Election | `write FAILOVER-01 majority` | May fail until a new primary exists | Acknowledged already ([JSON](results/failover_first.json)) |
| New primary elected | `write FAILOVER-02 majority` | Acknowledged | Acknowledged ([JSON](results/failover_second.json)) |
| Two members running | `write ACK-ALL 3` | UnknownWriteOutcome after the acknowledgement timeout | UnknownWriteOutcome; code 64, wtimeout ([JSON](results/ack_write.json)) |
| Two members running | `read ACK-ALL primary` | May return Present despite the write error | Present; all fields returned ([JSON](results/ack_read.json)) |
| One member, no majority | `read BASE-MAJ primary` | UnknownReadFailure | UnknownReadFailure ([JSON](results/no_majority_primary_read.json)) |
| One member, no majority | `read BASE-MAJ secondary` | UnknownReadFailure | Present, from the remaining secondary ([JSON](results/no_majority_secondary_read.json)) |
| One member, no majority | `write NO-MAJ-ONE 1` | UnknownWriteOutcome; changing w cannot elect a primary | UnknownWriteOutcome ([JSON](results/no_majority_one.json)) |
| One member, no majority | `write NO-MAJ-MAJ majority` | UnknownWriteOutcome | UnknownWriteOutcome ([JSON](results/no_majority_majority.json)) |
| One member, no majority | `verify BASE-MAJ` | UnknownReadFailure, not absence | UnknownReadFailure ([JSON](results/no_majority_verify.json)) |
| All members restored | `write RECOVERED-01 majority` | Acknowledged | Acknowledged ([JSON](results/recovered_write.json)) |

At the start, `mongo2` was PRIMARY and `mongo1` and `mongo3` were SECONDARY ([status](results/baseline_status.json)). After stopping `mongo2`, `mongo1` became PRIMARY ([status](results/failover_status.json)). The first failover write succeeded, despite the prediction that it might need to wait. The graceful stop and the command timing allowed the election to complete.

When `mongo2` returned, the set again contained one primary and two secondaries ([status](results/restored_status.json)). I then kept `mongo1` running and stopped `mongo2` and `mongo3`. `mongo1` changed to SECONDARY, with no PRIMARY available ([status](results/no_majority_status.json)). The read with primary preference failed, but the read with secondary preference returned `BASE-MAJ` with the expected fields. Both writes failed before a writable primary could be selected. Setting `w: 1` did not fix that.

The `ACK-ALL` response reported `WriteConcernFailed` (code 64) and `wtimeout: true`, with `n: 1` in the server response. The following primary read returned the inserted document. This did not establish that three copies had acknowledged it, but it did show that the timeout was not proof of absence.

A secondary can fall behind even when a particular read returns the same notice as a primary read. A timeout waiting for three acknowledgements does not prove the insert was rolled back. The read and later verification matter more than the write error alone.

## Read-only verification

The verifier compares `_id`, `tripId`, `status` and `sourceVersion` after a successful primary read using majority read concern. It reports `UnknownReadFailure` separately if it cannot read. A missing document is reported only as `AbsentAtVerification`.

Before recovery, the verification of `BASE-MAJ` failed with `UnknownReadFailure` because a primary could not be selected ([response](results/no_majority_verify.json)). After recovery, the same verifier could read again.

| Operation ID | Earlier write outcome | Verification after recovery | What I concluded |
| --- | --- | --- | --- |
| BASE-MAJ | Acknowledged, majority | PresentMatches | The complete notice was available |
| BASE-ONE | Acknowledged, w: 1 | PresentMatches | It was present at verification, not necessarily majority-acknowledged when written |
| FAILOVER-01 | Acknowledged, majority | PresentMatches | The write succeeded during the handover |
| FAILOVER-02 | Acknowledged, majority | PresentMatches | The replacement primary accepted the notice |
| ACK-ALL | UnknownWriteOutcome, w: 3 timeout | PresentMatches | The timeout did not mean the notice was absent |
| NO-MAJ-ONE | UnknownWriteOutcome | AbsentAtVerification | Nothing was found at this later read; the original error alone did not establish absence |
| NO-MAJ-MAJ | UnknownWriteOutcome | AbsentAtVerification | Same limitation |
| RECOVERED-01 | Acknowledged, majority | PresentMatches | Writes resumed after recovery |
| NEVER-SENT | No write attempted | AbsentAtVerification | Control case for a deliberately unwritten ID |

The full verification response is saved in [verification.json](results/verification.json). It uses a primary read with majority read concern. The supplied comparison checks also returned **7 passed, 0 failed** ([check.json](results/check.json)). Command exit codes are in [exits.txt](results/exits.txt).

## Application policy

| Operation | Freshness needed | During an outage | What the user sees | After recovery | Reason |
| --- | --- | --- | --- | --- | --- |
| Journey search | Recent timetable is useful, but a cached departure may already be cancelled | Allow searches using a copy while marking it as potentially old. Do not use it as final booking confirmation | Available journeys with a clear last-updated notice and a warning when live status cannot be checked | Refresh the copy from PostgreSQL and remove the warning once it is current | A secondary read can succeed while the authoritative source is unavailable, but it does not guarantee the latest cancellation |
| Ticket purchase | Must confirm current capacity, cancellation state and booking in PostgreSQL | Do not confirm purchases based only on the copied timetable. Treat an uncertain response as pending and check the same request before retrying | Booking is temporarily unavailable or its result is still being checked; no false confirmation | Check the original request and resume purchases when authoritative writes are available | The acknowledgement timeout may leave a stored write, and booking the last seat cannot depend on stale data |
| Reporting | Slightly delayed numbers are acceptable | Continue with the latest available snapshot, clearly labelled as delayed | Reports remain accessible with a data timestamp | Catch up and refresh reports | Reporting does not make irreversible ticket or payment decisions |

## AI second opinion

Model: GPT-6.

Prompt: "Review the `compareChange(actual, expected)` implementation in `scripts/verify.js` alongside the full outputs of `results/ack_write.json` and `results/ack_read.json`. The write used `w: 3` with a two-second timeout and returned `UnknownWriteOutcome`, code 64 (`WriteConcernFailed`), while a primary local read returned the notice with `_id: ACK-ALL`, `tripId: T102`, `status: Cancelled` and `sourceVersion: 2`. Is it correct to say the failed acknowledgement means the insert failed? Suggest a missing test or challenge this interpretation."

Response: The local read shows the document was present, not that all three members had acknowledged it. Check the same request ID using a primary read with majority read concern after recovery. The seven supplied comparison tests also omit a case where `tripId` is missing entirely.

I tried both checks. The recovery verifier returned `PresentMatches` for `ACK-ALL` ([verification.json](results/verification.json)). In a separate Node.js check, removing `tripId` from an otherwise matching document returned `PresentConflicts`, as expected. No changes to the provided test script were needed.

Decision: Keep the comparison function. Do not automatically repeat a timed-out cancellation request with a new ID. First inspect the original ID and all four fields. The experiment establishes what was present at the later verification point, not that every replica had acknowledged the write before the timeout.
