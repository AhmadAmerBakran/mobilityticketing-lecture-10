function compareChange(actual, expected) {
  if (actual === null) {
    return 'AbsentAtVerification';
  }

  const fields = ['_id', 'tripId', 'status', 'sourceVersion'];
  return fields.every(field => actual[field] === expected[field])
    ? 'PresentMatches'
    : 'PresentConflicts';
}
