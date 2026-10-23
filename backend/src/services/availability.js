const MISSING = { en: 'No commentary available', ar: 'لا يوجد تفسير متاح' };
function commentaryAvailability(available) {
  return { available: !!available, status: available ? 'available' : 'not_available', message: available ? null : MISSING };
}
module.exports = { commentaryAvailability };
