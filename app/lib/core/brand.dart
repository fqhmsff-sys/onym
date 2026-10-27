import 'package:flutter/material.dart';
import 'package:path_drawing/path_drawing.dart';

// Logo Onym: kepala + satu mata yang mengintip (viewBox 990x865). Tulisan "onym": huruf geometris TEBAL & KAKU (garis 40, ujung rata), viewBox 612x225.
const _headD = "M813 77C802 70 789 62 780 57C771 52 765 50 757 46C749 42 742 40 732 36C722 32 707 28 694 25C681 22 663 19 652 17C641 15 636 15 627 14C618 13 602 13 597 13C592 13 603 12 596 12C589 12 568 12 555 13C542 14 532 15 519 17C506 19 490 22 477 25C464 28 456 30 443 34C430 38 408 46 397 50C386 54 385 55 374 60C363 65 343 75 331 82C319 89 311 94 300 101C289 108 279 115 266 125C253 135 236 149 223 161C210 173 198 186 189 195C180 204 178 206 169 218C160 230 142 254 134 266C126 278 124 283 119 292C114 301 110 310 106 319C102 328 98 338 95 348C92 358 88 370 86 381C84 392 82 400 81 415C80 430 83 456 79 469C75 482 65 484 58 493C51 502 43 513 37 523C31 533 27 542 23 552C19 562 17 571 15 580C13 589 13 599 13 608C13 617 16 627 17 634C18 641 20 644 22 649C24 654 27 660 30 665C33 670 37 676 41 681C45 686 50 691 54 695C58 699 61 701 65 704C69 707 72 709 77 712C82 715 92 719 98 722C104 725 111 726 116 728C121 730 125 730 130 731C135 732 138 732 146 733C154 734 172 734 178 734C184 734 180 734 182 736C184 738 186 737 189 743C192 749 198 764 202 772C206 780 212 788 215 793C218 798 218 798 222 802C226 806 233 814 239 819C245 824 251 828 258 832C265 836 272 839 280 842C288 845 295 846 304 848C313 850 324 850 332 851C340 852 351 851 355 851C359 851 353 850 356 850C359 850 366 850 372 850C378 850 377 850 391 848C405 846 431 842 457 837C483 832 515 823 545 815C575 807 610 796 635 788C660 780 678 774 695 767C712 760 723 756 737 749C751 742 768 733 781 726C794 719 803 712 812 706C821 700 827 696 835 689C843 682 852 676 862 666C872 656 886 642 895 631C904 620 911 611 918 600C925 589 933 576 939 563C945 550 951 535 956 520C961 505 965 486 968 471C971 456 972 442 973 429C974 416 974 406 973 392C972 378 971 360 968 343C965 326 961 306 957 290C953 274 948 259 942 244C936 229 929 212 921 198C913 184 904 170 896 158C888 146 879 136 870 126C861 116 852 108 843 100C834 92 824 84 813 77Z M875 278C880 286 884 294 887 301C890 308 892 311 894 319C896 327 900 340 902 348C904 356 904 359 905 366C906 373 906 384 906 388C906 392 907 385 907 389C907 393 908 403 907 411C906 419 905 430 904 437C903 444 902 448 900 454C898 460 896 468 893 474C890 480 888 485 884 492C880 499 872 509 866 516C860 523 854 528 848 533C842 538 843 538 832 545C821 552 800 566 782 575C764 584 743 594 723 602C703 610 680 619 661 626C642 633 628 638 612 643C596 648 580 653 565 657C550 661 538 664 525 667C512 670 497 672 488 674C479 676 478 676 469 676C460 676 442 676 433 676C424 676 423 675 416 674C409 673 401 672 393 669C385 666 375 663 366 659C357 655 348 650 341 645C334 640 330 638 324 632C318 626 310 620 304 612C298 604 291 594 286 586C281 578 278 569 275 562C272 555 270 548 269 542C268 536 266 532 266 523C266 514 265 500 266 489C267 478 270 467 272 459C274 451 275 448 278 441C281 434 286 423 291 414C296 405 303 395 308 388C313 381 317 377 322 371C327 365 333 359 339 353C345 347 347 344 358 336C369 328 388 313 404 303C420 293 434 284 455 274C476 264 509 248 527 240C545 232 549 231 563 226C577 221 593 216 611 211C629 206 658 200 673 198C688 196 699 196 704 196C709 196 700 195 705 195C710 195 725 195 733 195C741 195 746 196 753 197C760 198 766 199 773 201C780 203 789 206 796 209C803 212 807 214 814 218C821 222 830 229 838 235C846 241 853 249 859 256C865 263 870 270 875 278Z";
const _eyeD = "M875 278C880 286 884 294 887 301C890 308 892 311 894 319C896 327 900 340 902 348C904 356 904 359 905 366C906 373 906 384 906 388C906 392 907 385 907 389C907 393 908 403 907 411C906 419 905 430 904 437C903 444 902 448 900 454C898 460 896 468 893 474C890 480 888 485 884 492C880 499 872 509 866 516C860 523 854 528 848 533C842 538 843 538 832 545C821 552 800 566 782 575C764 584 743 594 723 602C703 610 680 619 661 626C642 633 628 638 612 643C596 648 580 653 565 657C550 661 538 664 525 667C512 670 497 672 488 674C479 676 478 676 469 676C460 676 442 676 433 676C424 676 423 675 416 674C409 673 401 672 393 669C385 666 375 663 366 659C357 655 348 650 341 645C334 640 330 638 324 632C318 626 310 620 304 612C298 604 291 594 286 586C281 578 278 569 275 562C272 555 270 548 269 542C268 536 266 532 266 523C266 514 265 500 266 489C267 478 270 467 272 459C274 451 275 448 278 441C281 434 286 423 291 414C296 405 303 395 308 388C313 381 317 377 322 371C327 365 333 359 339 353C345 347 347 344 358 336C369 328 388 313 404 303C420 293 434 284 455 274C476 264 509 248 527 240C545 232 549 231 563 226C577 221 593 216 611 211C629 206 658 200 673 198C688 196 699 196 704 196C709 196 700 195 705 195C710 195 725 195 733 195C741 195 746 196 753 197C760 198 766 199 773 201C780 203 789 206 796 209C803 212 807 214 814 218C821 222 830 229 838 235C846 241 853 249 859 256C865 263 870 270 875 278Z";

Path _p(String d) => parseSvgPathData(d);
final Path _head = _p(_headD)..fillType = PathFillType.evenOdd;
final Path _eye = _p(_eyeD);

class _Letter { final double x; final List<String> strokes; const _Letter(this.x, this.strokes); }
const _letters = [
  _Letter(0, ['M61 40a41 41 0 1 1 0 82a41 41 0 1 1 0-82']),
  _Letter(144, ['M20 20V142', 'M20 82a42 42 0 0 1 84 0V142']),
  _Letter(290, ['M20 20V80a42 42 0 0 0 84 0V20', 'M104 20V170a30 30 0 0 1-30 30H44']),
  _Letter(436, ['M20 20V142', 'M20 74a34 34 0 0 1 68 0V142', 'M88 74a34 34 0 0 1 68 0V142']),
];
final List<List<Path>> _wordPaths = [for (final l in _letters) [for (final s in l.strokes) _p(s).shift(Offset(l.x, 0))]];

class MarkPainter extends CustomPainter {
  final Color color; final double head, iris;
  MarkPainter(this.color, {this.head = 1, this.iris = 1});
  @override
  void paint(Canvas c, Size size) {
    final s = size.width / 990;
    c.save();
    c.scale(s, s);
    final hs = 0.55 + 0.45 * head.clamp(0.0, 1.0).toDouble();
    c.translate(495 * (1 - hs), 432 * (1 - hs));
    c.scale(hs, hs);
    c.drawPath(_head, Paint()..color = color.withValues(alpha: head.clamp(0.0, 1.0).toDouble()));
    c.save();
    c.clipPath(_eye);
    final ir = iris < 0 ? 0.0 : iris;
    final a = iris.clamp(0.0, 1.0).toDouble();
    final shader = const LinearGradient(begin: Alignment.bottomLeft, end: Alignment.topRight, colors: [Color(0xFF52A8FF), Color(0xFF1B5FD1)])
        .createShader(const Rect.fromLTWH(660, 260, 220, 220));
    c.drawCircle(const Offset(770, 370), 110 * ir, Paint()..shader = shader..color = Colors.white.withValues(alpha: a));
    c.drawOval(Rect.fromCenter(center: const Offset(822, 310), width: 66 * ir, height: 76 * ir), Paint()..color = Colors.white.withValues(alpha: a));
    c.restore();
    c.restore();
  }
  @override
  bool shouldRepaint(MarkPainter o) => o.color != color || o.head != head || o.iris != iris;
}

class WordPainter extends CustomPainter {
  final Color color; final double progress;
  WordPainter(this.color, {this.progress = 1});
  @override
  void paint(Canvas c, Size size) {
    final s = size.width / 612;
    c.scale(s, s);
    final paint = Paint()..color = color..style = PaintingStyle.stroke..strokeWidth = 40..strokeCap = StrokeCap.butt..strokeJoin = StrokeJoin.round..isAntiAlias = true;
    for (var i = 0; i < _wordPaths.length; i++) {
      final f = ((progress * 1.9 - i * 0.38) / 0.85).clamp(0.0, 1.0).toDouble();
      if (f <= 0) continue;
      for (final p in _wordPaths[i]) {
        if (f >= 1) { c.drawPath(p, paint); continue; }
        for (final m in p.computeMetrics()) { c.drawPath(m.extractPath(0, m.length * f), paint); }
      }
    }
  }
  @override
  bool shouldRepaint(WordPainter o) => o.color != color || o.progress != progress;
}

class OnymMark extends StatelessWidget {
  final double height; final double head, iris;
  const OnymMark({super.key, this.height = 30, this.head = 1, this.iris = 1});
  @override
  Widget build(BuildContext context) => SizedBox(width: height * 990 / 865, height: height,
      child: CustomPaint(painter: MarkPainter(Theme.of(context).colorScheme.onSurface, head: head, iris: iris)));
}

class OnymWord extends StatelessWidget {
  final double height; final double progress;
  const OnymWord({super.key, this.height = 22, this.progress = 1});
  @override
  Widget build(BuildContext context) => SizedBox(width: height * 612 / 225, height: height,
      child: CustomPaint(painter: WordPainter(Theme.of(context).colorScheme.onSurface, progress: progress)));
}

/// Layar loading: kepala muncul → mata biru "pop" → tulisan onym digambar.
class LogoLoading extends StatefulWidget {
  final VoidCallback onDone; final bool animate;
  const LogoLoading({super.key, required this.onDone, this.animate = true});
  @override
  State<LogoLoading> createState() => _LogoLoadingState();
}

class _LogoLoadingState extends State<LogoLoading> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: Duration(milliseconds: widget.animate ? 2000 : 1));
  @override
  void initState() {
    super.initState();
    _c.forward().whenComplete(() { if (mounted) widget.onDone(); });
  }
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  double _iv(double a, double b, Curve k) => k.transform(((_c.value - a) / (b - a)).clamp(0.0, 1.0).toDouble());
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(child: AnimatedBuilder(animation: _c, builder: (_, __) => Column(mainAxisSize: MainAxisSize.min, children: [
      OnymMark(height: 112, head: _iv(0, .28, Curves.easeOutCubic), iris: _iv(.2, .55, Curves.elasticOut)),
      const SizedBox(height: 30),
      OnymWord(height: 78, progress: _iv(.32, .95, Curves.easeInOutCubic)),
    ]))),
  );
}
