# Which of OpenCV goes into vendor/opencv.js.
#
# The stock build is everything: deep learning, video tracking, feature
# matching, photography, calibration - ten megabytes of it, on a phone, to read
# a sheet of paper. This list is the other way round: it starts empty and holds
# only the calls js/scan/card.js actually makes, which is three modules and
# about thirty functions.
#
# Keep it in step with card.js. A call that is not listed here is not in the
# build, and the failure is a TypeError at the moment someone scans a card - so
# when the pipeline gains a function, it gains a line here too.

core = {
    '': [
        'add',                  # merging the horizontal and vertical rules
    ],
    'Algorithm': [],
}

imgproc = {
    '': [
        'adaptiveThreshold',    # paper is never evenly lit
        'boundingRect',
        'connectedComponentsWithStats',
        'cvtColor',
        'findContours',
        'getPerspectiveTransform',
        'getStructuringElement',
        'moments',
        'morphologyEx',         # opening out the ruling, closing broken strokes
        'resize',
        'warpPerspective',      # squaring up a card shot at an angle
    ],
}

# The three bytes on the card saying which match the sheet belongs to.
#
# QRCodeDetector inherits its methods from GraphicalCodeDetector, and embind
# refuses to construct a class whose base it has not been told about - so the
# base is here even though nothing calls it directly.
objdetect = {
    'GraphicalCodeDetector': ['detect', 'decode', 'detectAndDecode'],
    'QRCodeDetector': ['QRCodeDetector', 'detect', 'decode', 'detectAndDecode'],
}

white_list = makeWhiteList([core, imgproc, objdetect])
