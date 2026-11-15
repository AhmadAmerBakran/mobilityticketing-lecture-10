# Lecture 10 evidence

These are test notices in MongoDB, not cancellations of real departures. PostgreSQL remains responsible for timetables and bookings. I used the supplied Docker Compose setup and kept a separate request ID for each write. The experiments run on a GitHub Actions Linux runner.

## Experiments

Before starting, I expected a majority write to need two acknowledgements out of three and a write with `w: 1` to need only the primary. A write with `w: 3` needs all three members. The service names are fixed, but I check the member states instead of assuming which one is primary.

| Situation | Command | Prediction | Observed |
| --- | --- | --- | --- |
| Three members | `write BASE-MAJ majority` | Acknowledged by a majority | Pending runner output |
| Three members | `write BASE-ONE 1` | Acknowledged by primary | Pending runner output |
| Three members | `read BASE-MAJ primary` | Present | Pending runner output |
| Three members | `read BASE-MAJ secondary` | Present if replication has caught up | Pending runner output |
| First primary stopped | `read BASE-MAJ secondary` | Present from a remaining secondary | Pending runner output |
| Election | `write FAILOVER-01 majority` | May fail until a new primary exists | Pending runner output |
| New primary elected | `write FAILOVER-02 majority` | Acknowledged | Pending runner output |
| Two members running | `write ACK-ALL 3` | UnknownWriteOutcome after the acknowledgement timeout | Pending runner output |
| Two members running | `read ACK-ALL primary` | May return Present despite the write error | Pending runner output |
| One member, no majority | `read BASE-MAJ primary` | UnknownReadFailure | Pending runner output |
| One member, no majority | `read BASE-MAJ secondary` | UnknownReadFailure | Pending runner output |
| One member, no majority | `write NO-MAJ-ONE 1` | UnknownWriteOutcome; changing w cannot elect a primary | Pending runner output |
| One member, no majority | `write NO-MAJ-MAJ majority` | UnknownWriteOutcome | Pending runner output |
| One member, no majority | `verify BASE-MAJ` | UnknownReadFailure, not absence | Pending runner output |
| All members restored | `write RECOVERED-01 majority` | Acknowledged | Pending runner output |

A secondary can fall behind even when a particular read returns the same notice as a primary read. A timeout waiting for three acknowledgements does not prove the insert was rolled back. The read and later verification matter more than the write error alone.

## Read-only verification

The verifier compares `_id`, `tripId`, `status` and `sourceVersion` after a successful primary read using majority read concern. It reports `UnknownReadFailure` separately if it cannot read. A missing document is reported only as `AbsentAtVerification`.

The results for `BASE-MAJ`, `BASE-ONE`, `FAILOVER-01`, `FAILOVER-02`, `ACK-ALL`, `NO-MAJ-ONE`, `NO-MAJ-MAJ`, `RECOVERED-01` and the unwritten control `NEVER-SENT` will be recorded after recovery.

## Application policy

| Operation | Freshness needed | During an outage | What the user sees | After recovery | Reason |
| --- | --- | --- | --- | --- | --- |
| Journey search | Recent timetable is useful, but a cached departure may already be cancelled | Allow searches using a copy while marking it as potentially old. Do not use it as final booking confirmation | Available journeys with a clear last-updated notice and a warning when live status cannot be checked | Refresh the copy from PostgreSQL and remove the warning once it is current | A secondary read can succeed while the authoritative source is unavailable, but it does not guarantee the latest cancellation |
| Ticket purchase | Must confirm current capacity, cancellation state and booking in PostgreSQL | Do not confirm purchases based only on the copied timetable. Treat an uncertain response as pending and check the same request before retrying | Booking is temporarily unavailable or its result is still being checked; no false confirmation | Check the original request and resume purchases when authoritative writes are available | The acknowledgement timeout may leave a stored write, and booking the last seat cannot depend on stale data |
| Reporting | Slightly delayed numbers are acceptable | Continue with the latest available snapshot, clearly labelled as delayed | Reports remain accessible with a data timestamp | Catch up and refresh reports | Reporting does not make irreversible ticket or payment decisions |

## AI second opinion

The comparison function and the actual `ACK-ALL` write/read responses will be reviewed here after the run. The suggestion will be tested and the result recorded rather than treated as proof without checking it.
