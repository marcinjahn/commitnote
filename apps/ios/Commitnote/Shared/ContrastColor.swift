import UIKit

extension UIColor {
    func softened(alpha: CGFloat) -> UIColor {
        UIColor { traits in
            traits.accessibilityContrast == .high ? self : self.withAlphaComponent(alpha)
        }
    }
}
