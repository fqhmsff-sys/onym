import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/i18n.dart';
import '../core/util.dart';
import '../data/models.dart';
import '../data/repo.dart';
import 'widgets.dart';

class NotificationsTab extends StatefulWidget {
  final VoidCallback onRead;
  const NotificationsTab({super.key, required this.onRead});
  @override
  State<NotificationsTab> createState() => _NotifState();
}
class _NotifState extends State<NotificationsTab> {
  Future<Pg<Notif>> _load(String? cursor) async {
    final pg = await Repo.i.notifications(cursor: cursor);
    if (cursor == null) { Repo.i.markRead().then((_) => widget.onRead()); }
    return pg;
  }
  @override
  Widget build(BuildContext context) => Column(children: [
    Align(alignment: Alignment.centerLeft, child: Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 8), child: Text(tr('n.title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 22)))),
    Expanded(child: PagedList<Notif>(load: _load, empty: tr('n.empty'), item: (c, n) {
      final u = n.actor; final name = u?.displayName ?? '…';
      return ListTile(
        tileColor: n.read ? null : Theme.of(context).colorScheme.primary.withValues(alpha: .06),
        leading: Avatar(keyPath: u?.avatar, name: name, size: 42),
        title: Text.rich(TextSpan(children: [TextSpan(text: name, style: const TextStyle(fontWeight: FontWeight.w700)), TextSpan(text: ' ${tr('n.${n.type}')}')])),
        subtitle: Text(ago(n.createdAt, tr)),
        onTap: () { if (n.postId != null) { context.push('/p/${n.postId}'); } else if (u != null) { context.push('/u/${u.username}'); } },
      );
    })),
  ]);
}
