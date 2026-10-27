import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:video_player/video_player.dart';
import '../core/util.dart';
import '../data/models.dart';
import '../data/repo.dart';

const _cardRadius = 14.0;
const _gap = 8.0;

void openViewer(BuildContext context, List<MediaItem> items, int index, Post post) =>
    Navigator.of(context).push(PageRouteBuilder(opaque: true, transitionDuration: const Duration(milliseconds: 180), reverseTransitionDuration: const Duration(milliseconds: 140),
      pageBuilder: (_, __, ___) => MediaViewer(items, index, post), transitionsBuilder: (_, a, __, c) => FadeTransition(opacity: a, child: c)));

/// Media di dalam postingan: satu → kartu tunggal; banyak → digeser menyamping, kartu berikutnya MENGINTIP, penanda "1 / 3" lewat [index].
class MediaCarousel extends StatefulWidget {
  final List<MediaItem> items; final Post post; final ValueNotifier<int>? index;
  const MediaCarousel(this.items, this.post, {super.key, this.index});
  @override
  State<MediaCarousel> createState() => _MediaCarouselState();
}

class _MediaCarouselState extends State<MediaCarousel> {
  PageController? _pc; double _vf = 0; final List<PageController> _old = [];
  @override
  void dispose() { _pc?.dispose(); for (final c in _old) { c.dispose(); } super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final items = widget.items;
    return LayoutBuilder(builder: (context, cons) {
      final avail = cons.maxWidth;                       // lebar kolom sampai tepi layar
      if (items.length == 1) return _single(context, items.first, avail);
      final cardW = (avail - 14) * 0.58, h = cardW / 0.75;
      final vf = (cardW + _gap) / avail;
      if (_pc == null || _vf != vf) { if (_pc != null) _old.add(_pc!); _vf = vf; _pc = PageController(viewportFraction: vf); }
      return SizedBox(height: h, child: PageView.builder(controller: _pc, padEnds: false, itemCount: items.length, clipBehavior: Clip.none,
        onPageChanged: (i) => widget.index?.value = i,
        itemBuilder: (c, i) => Padding(padding: const EdgeInsets.only(right: _gap), child: SizedBox(width: cardW, height: h, child: _Card(items[i], onTap: () => openViewer(context, items, i, widget.post))))));
    });
  }

  Widget _single(BuildContext context, MediaItem m, double avail) {
    final maxW = avail - 14 > 380 ? 380.0 : avail - 14;
    if (m.isAudio) return Padding(padding: const EdgeInsets.only(right: 14), child: AudioTile(m));
    double aspect;
    if (m.isVideo) { aspect = (m.w > 0 && m.h > 0 ? m.w / m.h : 0.75).clamp(0.6, 1.6).toDouble(); }
    else { final r = m.h > 0 ? m.w / m.h : 1.0; aspect = (r < 0.75 ? 0.75 : r.clamp(0.75, 1.7)).toDouble(); }   // foto panjang: lebar penuh, tinggi dibatasi, rata atas
    var w = maxW, h = w / aspect; if (h > 460) { h = 460; w = h * aspect; }
    final tall = !m.isVideo && m.h > 0 && m.w / m.h < 0.75;
    return SizedBox(width: w, height: h, child: _Card(m, onTap: () => openViewer(context, [m], 0, widget.post), tall: tall));
  }
}

class _Card extends StatelessWidget {
  final MediaItem m; final VoidCallback onTap; final bool tall;
  const _Card(this.m, {required this.onTap, this.tall = false});
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme; final url = Repo.i.urlFor(m.key);
    Widget body;
    if (m.isPhoto) {
      body = url == null ? Container(color: cs.surfaceContainerHighest)
        : CachedNetworkImage(imageUrl: url, cacheKey: m.key, fit: BoxFit.cover, alignment: tall ? Alignment.topCenter : Alignment.center, width: double.infinity, height: double.infinity,
            fadeInDuration: const Duration(milliseconds: 120), placeholder: (_, __) => Container(color: cs.surfaceContainerHighest), errorWidget: (_, __, ___) => Container(color: cs.surfaceContainerHighest, child: const Icon(Icons.broken_image_outlined)));
    } else if (m.isVideo) {
      body = Container(color: const Color(0xFF161616), child: Stack(children: [
        const Center(child: _PlayDisc()),
        if (m.d > 0) Positioned(left: 10, bottom: 10, child: _Pill(fmtDur(m.d))),
      ]));
    } else {
      body = Container(color: cs.surfaceContainerHighest, child: Stack(children: [
        Center(child: Icon(Icons.graphic_eq, size: 44, color: cs.onSurface.withValues(alpha: .6))),
        if (m.d > 0) Positioned(left: 10, bottom: 10, child: _Pill(fmtDur(m.d), dark: false)),
      ]));
    }
    return GestureDetector(onTap: onTap, child: ClipRRect(borderRadius: BorderRadius.circular(_cardRadius), child: Stack(fit: StackFit.expand, children: [
      body,
      DecoratedBox(decoration: BoxDecoration(borderRadius: BorderRadius.circular(_cardRadius), border: Border.all(color: Colors.black.withValues(alpha: .06), width: .5))),
      if (tall) Positioned(right: 10, bottom: 10, child: Container(padding: const EdgeInsets.all(6), decoration: const BoxDecoration(color: Color(0x99000000), shape: BoxShape.circle), child: const Icon(Icons.open_in_full, size: 14, color: Colors.white))),
    ])));
  }
}

class _PlayDisc extends StatelessWidget {
  const _PlayDisc();
  @override
  Widget build(BuildContext context) => Container(width: 58, height: 58, decoration: const BoxDecoration(color: Color(0xE6FFFFFF), shape: BoxShape.circle), child: const Icon(Icons.play_arrow_rounded, size: 38, color: Colors.black));
}
class _Pill extends StatelessWidget {
  final String t; final bool dark;
  const _Pill(this.t, {this.dark = true});
  @override
  Widget build(BuildContext context) => Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: dark ? const Color(0x99000000) : const Color(0x14000000), borderRadius: BorderRadius.circular(10)),
    child: Text(t, style: TextStyle(color: dark ? Colors.white : Colors.black87, fontSize: 12, fontWeight: FontWeight.w600)));
}

/// Penanda "1 / 3" di samping teks (seperti Threads).
class IndexPill extends StatelessWidget {
  final ValueNotifier<int> index; final int total;
  const IndexPill(this.index, this.total, {super.key});
  @override
  Widget build(BuildContext context) => ValueListenableBuilder<int>(valueListenable: index, builder: (_, i, __) => Container(padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
    decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
    child: Text('${i + 1} / $total', style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: .6), fontWeight: FontWeight.w600))));
}

// ===================================================================== Pemutar layar penuh (hitam, bisa digeser antar-media)
class MediaViewer extends StatefulWidget {
  final List<MediaItem> items; final int start; final Post post;
  const MediaViewer(this.items, this.start, this.post, {super.key});
  @override
  State<MediaViewer> createState() => _MediaViewerState();
}
class _MediaViewerState extends State<MediaViewer> {
  late final PageController _pc = PageController(initialPage: widget.start); late int _i = widget.start; bool _zoomed = false;
  @override
  void dispose() { _pc.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final p = widget.post; const white = Colors.white;
    Widget circle(IconData i, VoidCallback f) => GestureDetector(onTap: f, child: Container(width: 40, height: 40, decoration: const BoxDecoration(color: Color(0x66404040), shape: BoxShape.circle), child: Icon(i, color: white, size: 22)));
    Widget stat(IconData i, String n) => Row(mainAxisSize: MainAxisSize.min, children: [Icon(i, color: white, size: 24), const SizedBox(width: 6), Text(n, style: const TextStyle(color: white, fontSize: 15))]);
    return Scaffold(backgroundColor: Colors.black, body: Stack(children: [
      PageView.builder(controller: _pc, itemCount: widget.items.length, physics: _zoomed ? const NeverScrollableScrollPhysics() : null, onPageChanged: (i) => setState(() => _i = i),
        itemBuilder: (c, i) => _Page(widget.items[i], onZoom: (z) { if (z != _zoomed) setState(() => _zoomed = z); })),
      SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(14, 8, 14, 0), child: Row(children: [
        circle(Icons.close, () => Navigator.of(context).pop()), const Spacer(),
        if (widget.items.length > 1) Container(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), decoration: BoxDecoration(color: const Color(0x66404040), borderRadius: BorderRadius.circular(14)), child: Text('${_i + 1} / ${widget.items.length}', style: const TextStyle(color: white, fontWeight: FontWeight.w600))),
      ]))),
      Positioned(left: 0, right: 0, bottom: 0, child: SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 14), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        stat(p.starred ? Icons.favorite : Icons.favorite_border, '${p.stars}'), const SizedBox(width: 28), stat(Icons.chat_bubble_outline, '${p.comments}'),
        if (p.ratingCount > 0) ...[const SizedBox(width: 28), stat(Icons.star_border_rounded, p.ratingAvg?.toStringAsFixed(1) ?? '')],
      ])))),
    ]));
  }
}

class _Page extends StatelessWidget {
  final MediaItem m; final void Function(bool) onZoom;
  const _Page(this.m, {required this.onZoom});
  @override
  Widget build(BuildContext context) {
    if (m.isVideo) return _VideoPage(m);
    if (m.isAudio) return _AudioPage(m);
    final url = Repo.i.urlFor(m.key);
    return Center(child: url == null ? const SizedBox.shrink() : _Zoom(onZoom: onZoom, child: CachedNetworkImage(imageUrl: url, cacheKey: m.key, fit: BoxFit.contain, width: double.infinity, height: double.infinity,
      placeholder: (_, __) => const Center(child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white54)))));
  }
}
class _Zoom extends StatefulWidget {
  final Widget child; final void Function(bool) onZoom;
  const _Zoom({required this.child, required this.onZoom});
  @override
  State<_Zoom> createState() => _ZoomState();
}
class _ZoomState extends State<_Zoom> {
  final _t = TransformationController();
  @override
  void dispose() { _t.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => GestureDetector(
    onDoubleTap: () { final z = _t.value.getMaxScaleOnAxis() > 1.05; _t.value = z ? Matrix4.identity() : (Matrix4.identity()..scale(2.5)); widget.onZoom(!z); },
    child: InteractiveViewer(transformationController: _t, minScale: 1, maxScale: 6, onInteractionEnd: (_) => widget.onZoom(_t.value.getMaxScaleOnAxis() > 1.05), child: widget.child));
}

class _VideoPage extends StatefulWidget {
  final MediaItem m;
  const _VideoPage(this.m);
  @override
  State<_VideoPage> createState() => _VideoPageState();
}
class _VideoPageState extends State<_VideoPage> {
  VideoPlayerController? _c; bool _err = false, _muted = false;
  @override
  void initState() {
    super.initState();
    final url = Repo.i.urlFor(widget.m.key); if (url == null) { _err = true; return; }
    final c = VideoPlayerController.networkUrl(Uri.parse(url));
    c.initialize().then((_) { if (!mounted) { c.dispose(); return; } c.setLooping(true); c.play(); setState(() => _c = c); }).catchError((_) { if (mounted) setState(() => _err = true); });
  }
  @override
  void dispose() { _c?.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final c = _c;
    if (_err) return const Center(child: Icon(Icons.error_outline, color: Colors.white54, size: 40));
    if (c == null) return const Center(child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white54));
    return GestureDetector(onTap: () => setState(() => c.value.isPlaying ? c.pause() : c.play()), child: Stack(alignment: Alignment.center, children: [
      Center(child: AspectRatio(aspectRatio: c.value.aspectRatio, child: VideoPlayer(c))),
      if (!c.value.isPlaying) const _PlayDisc(),
      Positioned(left: 16, right: 16, bottom: 70, child: Row(children: [
        Expanded(child: VideoProgressIndicator(c, allowScrubbing: true, colors: const VideoProgressColors(playedColor: Colors.white, bufferedColor: Colors.white24, backgroundColor: Colors.white12))),
        IconButton(onPressed: () => setState(() { _muted = !_muted; c.setVolume(_muted ? 0 : 1); }), icon: Icon(_muted ? Icons.volume_off : Icons.volume_up, color: Colors.white)),
      ])),
    ]));
  }
}
class _AudioPage extends StatelessWidget {
  final MediaItem m;
  const _AudioPage(this.m);
  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(28), child: Theme(data: ThemeData.dark(), child: AudioTile(m))));
}

// ===================================================================== Audio (ringkas, tanpa kotak besar)
class AudioTile extends StatefulWidget {
  final MediaItem m;
  const AudioTile(this.m, {super.key});
  @override
  State<AudioTile> createState() => _AudioTileState();
}
class _AudioTileState extends State<AudioTile> {
  AudioPlayer? _p; bool _loading = false, _err = false;
  @override
  void dispose() { _p?.dispose(); super.dispose(); }
  Future<void> _toggle() async {
    if (_p == null) {
      final url = Repo.i.urlFor(widget.m.key); if (url == null) return;
      setState(() => _loading = true);
      try { final p = AudioPlayer(); await p.setUrl(url); _p = p; await p.play(); } catch (_) { _err = true; }
      if (mounted) setState(() => _loading = false); return;
    }
    _p!.playing ? await _p!.pause() : await _p!.play();
  }
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme; final p = _p;
    return Container(padding: const EdgeInsets.fromLTRB(6, 4, 14, 4), decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(_cardRadius)), child: Row(children: [
      StreamBuilder<PlayerState>(stream: p?.playerStateStream, builder: (_, s) => IconButton(onPressed: _toggle, icon: _loading ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: cs.onSurface))
          : Icon(_err ? Icons.error_outline : (s.data?.playing ?? false) ? Icons.pause_circle_filled : Icons.play_circle_fill, size: 38, color: cs.onSurface))),
      Expanded(child: p == null ? Text(widget.m.d > 0 ? fmtDur(widget.m.d) : '', style: TextStyle(color: cs.onSurface.withValues(alpha: .55)))
        : StreamBuilder<Duration>(stream: p.positionStream, builder: (_, s) {
            final total = (p.duration ?? Duration(milliseconds: widget.m.d)).inMilliseconds.clamp(1, 1 << 30); final pos = (s.data?.inMilliseconds ?? 0).clamp(0, total);
            return SliderTheme(data: SliderTheme.of(context).copyWith(trackHeight: 3, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6), overlayShape: SliderComponentShape.noOverlay, activeTrackColor: cs.onSurface, inactiveTrackColor: cs.outline, thumbColor: cs.onSurface),
              child: Slider(value: pos.toDouble(), max: total.toDouble(), onChanged: (v) => p.seek(Duration(milliseconds: v.round()))));
          })),
    ]));
  }
}
