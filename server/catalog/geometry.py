"""
Geometric verification: does the query crop and a candidate reference show the same object?

An embedding answers "do these look alike". Keypoint matching answers a stricter question: can
the two images be put into correspondence by a single planar transform. Two flavours of the same
snack in identical packaging look alike to any encoder and differ in a band of text and a colour
patch, which is precisely the evidence a keypoint match keeps and a global average destroys.
This is the classical instance-recognition reranker and it is here because the failure mode it
addresses is the one the measurements show: the right SKU is in the shortlist 87% of the time
and first only 66% of the time.

It is far too slow to run over a whole catalog and perfectly affordable over five candidates,
which is the entire argument for shortlist-then-rerank.

Score is the RANSAC inlier count. Not the raw match count: a repeated texture such as a barcode
or a grid of identical letters produces plenty of matches between unrelated packets, and they
survive only if they also agree on one geometry.
"""
import numpy as np

RATIO = 0.8  # Lowe's ratio test. Above this the second-best match is too close to trust.
MAX_FEATURES = 600
MIN_MATCHES = 4  # a homography needs four correspondences
REPROJECT_PX = 5.0


def _sift():
    import cv2

    if not hasattr(_sift, "instance"):
        _sift.instance = cv2.SIFT_create(nfeatures=MAX_FEATURES)
    return _sift.instance


def describe_gray(image):
    """RootSIFT keypoints and descriptors for a greyscale array.

    RootSIFT is plain SIFT with the descriptor L1-normalized and square-rooted. It costs one
    line, makes Euclidean distance behave like a Hellinger distance, and is a consistent win on
    every matching benchmark it has been tried on, so there is no reason to use raw SIFT.
    """
    if image is None:
        return None, None
    keypoints, desc = _sift().detectAndCompute(image, None)
    if desc is None or len(keypoints) < MIN_MATCHES:
        return None, None
    desc = desc / np.maximum(desc.sum(axis=1, keepdims=True), 1e-7)
    desc = np.sqrt(desc).astype(np.float32)
    return np.array([kp.pt for kp in keypoints], dtype=np.float32), desc


def describe(path):
    """Same, reading from disk. Catalog references live as files; query crops do not."""
    import cv2

    return describe_gray(cv2.imread(str(path), cv2.IMREAD_GRAYSCALE))


def describe_image(image):
    """Same, from a PIL image, which is what a freshly cropped detection arrives as."""
    import cv2

    return describe_gray(cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2GRAY))


def inliers(query, reference):
    """How many keypoint matches survive both the ratio test and a single homography."""
    import cv2

    q_pts, q_desc = query
    r_pts, r_desc = reference
    if q_desc is None or r_desc is None:
        return 0

    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(q_desc, r_desc, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < RATIO * n.distance]
    if len(good) < MIN_MATCHES:
        return 0

    src = np.array([q_pts[m.queryIdx] for m in good], dtype=np.float32).reshape(-1, 1, 2)
    dst = np.array([r_pts[m.trainIdx] for m in good], dtype=np.float32).reshape(-1, 1, 2)
    method = getattr(cv2, "USAC_MAGSAC", cv2.RANSAC)
    _, mask = cv2.findHomography(src, dst, method, REPROJECT_PX)
    return 0 if mask is None else int(mask.sum())
