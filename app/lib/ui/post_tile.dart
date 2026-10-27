import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import '../core/config.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../data/models.dart';
import '../data/repo.dart';
import 'media_views.dart';
import 'widgets.dart';

/// Postingan bergaya Threads: avatar di kiri, isi di kanan, tanpa kartu — dipisah garis tipis oleh daftar.
class PostTile extends StatefulWidget {
  final Post post; final bool detail; final void Function(Post)? onDeleted; final void Function(Post)? onChanged;
  const PostTile(this.post, {super.key, this.detail = false, this.onDeleted, this.onChanged});
  @override
  State<PostTile> createState() => _PostTileState();
}

class _PostTileState extends State<PostTile> {
  late Post p = widget.post; final _idx = ValueNotifier<int>(0);
  @override
  void dispose() { _idx.dispose(); super.dispose(); }
  @override
  void didUpdateWidget(PostTile o) { super.didUpdateWidget(o); if (o.post != widget.post) p = widget.post; }
  void _set(Post n) { setState(() => p = n); widget.onChanged?.call(n); }
  bool get mine => Repo.i.signedIn && p.authorId == Repo.i.uid;

  Future<void> _guard(Future<void> Function() f, Post rollback) async { try { await f(); } catch (e) { if (mounted) { _set(rollback); toast(context, errText(e, tr)); } } }
  void _star() { final old = p; _set(p.copyWith(starred: !p.starred, stars: p.stars + (p.starred ? -1 : 1))); _guard(() => Repo.i.setStar(old.id, !old.starred), old); }
  void _save() { final old = p; _set(p.copyWith(saved: !p.saved)); _guard(() => Repo.i.setSave(old.id, !old.saved), old); }
  Future<void> _share() async {
    final url = '${Cfg.webOrigin}/p/${p.id}';
    if (kIsWeb || Cfg.webOrigin.isEmpty) { await Clipboard.setData(ClipboardData(text: url)); if (mounted) toast(context, tr('copied')); } else { await Share.share(url); }
  }
  Future<void> _rate() async {
    final v = await showModalBottomSheet<int>(context: context, builder: (c) => SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 20), child: Column(mainAxisSize: MainAxisSize.min, children: [
      Text(tr('post.rate'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)), const SizedBox(height: 10),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [for (var i = 1; i <= 5; i++) IconButton(iconSize: 38, onPressed: () => Navigator.pop(c, i), icon: Icon((p.myRating ?? 0) >= i ? Icons.star_rounded : Icons.star_outline_rounded, color: OC.star))]),
      if (p.myRating != null) TextButton(onPressed: () => Navigator.pop(c, 0), child: Text(tr('delete'))),
    ]))));
    if (v == null) return;
    final old = p;
    try { await Repo.i.rate(p.id, v == 0 ? null : v); final fresh = await Repo.i.post(p.id); if (fresh != null && mounted) _set(fresh); } catch (e) { if (mounted) { _set(old); toast(context, errText(e, tr)); } }
  }
  Future<void> _more() async {
    final act = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: Icon(p.saved ? Icons.bookmark : Icons.bookmark_border), title: Text(p.saved ? tr('post.unsave') : tr('post.save')), onTap: () => Navigator.pop(c, 'save')),
      ListTile(leading: const Icon(Icons.ios_share), title: Text(tr('post.share')), onTap: () => Navigator.pop(c, 'share')),
      if (mine) ListTile(leading: const Icon(Icons.edit_outlined), title: Text(tr('post.edit')), onTap: () => Navigator.pop(c, 'edit')),
      if (mine) ListTile(leading: const Icon(Icons.delete_outline, color: OC.like), title: Text(tr('post.delete'), style: const TextStyle(color: OC.like)), onTap: () => Navigator.pop(c, 'delete')),
      if (!mine) ListTile(leading: const Icon(Icons.flag_outlined, color: OC.like), title: Text(tr('post.report'), style: const TextStyle(color: OC.like)), onTap: () => Navigator.pop(c, 'report')),
    ])));
    if (act == null || !mounted) return;
    switch (act) {
      case 'save': return _save();
      case 'share': return _share();
      case 'edit': final r = await context.push<Post>('/compose', extra: p); if (r != null && mounted) _set(r); return;
      case 'delete':
        if (!await confirm(context, tr('post.deleteAsk'), ok: tr('delete'))) return;
        try { await Repo.i.deletePost(p); widget.onDeleted?.call(p); if (widget.detail && mounted) context.pop(); } catch (e) { if (mounted) toast(context, errText(e, tr)); }
        return;
      case 'report':
        final reason = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final k in ['spam', 'kekerasan', 'pelecehan', 'ilegal', 'lainnya']) ListTile(title: Text(tr('rep.$k')), onTap: () => Navigator.pop(c, k)),
        ])));
        if (reason == null) return;
        try { await Repo.i.report(p.id, reason); if (mounted) toast(context, tr('post.reported')); } catch (e) { if (mounted) toast(context, errText(e, tr)); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme; final mute = cs.onSurface.withValues(alpha: .5); final ink = cs.onSurface.withValues(alpha: .78);
    final multi = p.media.length > 1;
    return InkWell(
      onTap: widget.detail ? null : () => context.push('/p/${p.id}', extra: p),
      child: Padding(padding: const EdgeInsets.fromLTRB(14, 12, 0, 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        GestureDetector(onTap: () => context.push('/u/${p.authorHandle}'), child: Avatar(keyPath: p.authorAvatar, name: p.authorName, size: 40)),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.only(right: 4), child: Row(children: [
            Flexible(child: GestureDetector(onTap: () => context.push('/u/${p.authorHandle}'), child: Text(p.authorHandle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15.5)))),
            const SizedBox(width: 8), Text(ago(p.createdAt, tr), style: TextStyle(color: mute, fontSize: 15)),
            if (p.visibility != 'public') Padding(padding: const EdgeInsets.only(left: 6), child: Icon(p.visibility == 'me' ? Icons.lock_outline : Icons.group_outlined, size: 14, color: mute)),
            const Spacer(),
            if (multi) Padding(padding: const EdgeInsets.only(right: 4), child: IndexPill(_idx, p.media.length)),
            IconButton(onPressed: _more, visualDensity: VisualDensity.compact, padding: EdgeInsets.zero, constraints: const BoxConstraints(minWidth: 36, minHeight: 32), icon: Icon(Icons.more_horiz, color: mute)),
          ])),
          if (p.body.isNotEmpty) Padding(padding: const EdgeInsets.only(right: 14, top: 1), child: Text(p.body, style: const TextStyle(fontSize: 16, height: 1.32))),
          if (p.media.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: MediaCarousel(p.media, p, index: _idx)),
          const SizedBox(height: 4),
          Row(children: [
            _Act(icon: p.starred ? Icons.favorite : Icons.favorite_border, color: p.starred ? OC.like : ink, label: p.stars > 0 ? '${p.stars}' : '', onTap: _star),
            _Act(icon: Icons.chat_bubble_outline_rounded, color: ink, label: p.comments > 0 ? '${p.comments}' : '', onTap: () => widget.detail ? null : context.push('/p/${p.id}', extra: p)),
            _Act(icon: (p.myRating ?? 0) > 0 ? Icons.star_rounded : Icons.star_border_rounded, color: (p.myRating ?? 0) > 0 ? OC.star : ink, label: p.ratingCount > 0 ? (p.ratingAvg?.toStringAsFixed(1) ?? '') : '', onTap: _rate),
            _Act(icon: Icons.send_outlined, color: ink, label: '', onTap: _share),
          ]),
          const SizedBox(height: 6),
        ])),
      ])),
    );
  }
}

class _Act extends StatelessWidget {
  final IconData icon; final Color color; final String label; final VoidCallback? onTap;
  const _Act({required this.icon, required this.color, required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) => InkResponse(onTap: onTap, radius: 22, child: Padding(padding: const EdgeInsets.only(right: 16, top: 8, bottom: 8, left: 0),
    child: Row(children: [Icon(icon, size: 23, color: color), if (label.isNotEmpty) Padding(padding: const EdgeInsets.only(left: 5), child: Text(label, style: TextStyle(color: color, fontSize: 14.5)))])));
}
