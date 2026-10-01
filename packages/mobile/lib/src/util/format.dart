import 'package:intl/intl.dart';

/// Compact relative time for lists: `now`, `5m`, `3h`, `Yesterday`, `Mon`,
/// `12 Mar`, `12 Mar 2025`. [now] is injectable for tests.
String formatRelative(DateTime time, {DateTime? now}) {
  final n = now ?? DateTime.now();
  final t = time.toLocal();
  final diff = n.difference(t);
  if (diff.inSeconds < 45) return 'now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(t.year, t.month, t.day);
  final days = today.difference(day).inDays;
  if (days == 0) return '${diff.inHours}h';
  if (days == 1) return 'Yesterday';
  if (days < 7) return DateFormat.E().format(t);
  if (t.year == n.year) return DateFormat('d MMM').format(t);
  return DateFormat('d MMM y').format(t);
}

/// `14:05`, in the device's 24h/12h convention for the default locale.
String formatClock(DateTime time) => DateFormat.jm().format(time.toLocal());

/// `12 Mar 2026, 14:05`.
String formatDateTime(DateTime time) =>
    DateFormat('d MMM y, ').add_jm().format(time.toLocal());

/// `12 Mar 2026`.
String formatDate(DateTime time) => DateFormat('d MMM y').format(time.toLocal());

/// `1.2k`, `3.4M`.
String formatCompact(num value) => NumberFormat.compact().format(value);

/// `3 tasks`, `1 task`. [plural] defaults to [singular] + `s`.
String plural(int count, String singular, [String? plural]) =>
    '$count ${count == 1 ? singular : (plural ?? '${singular}s')}';
