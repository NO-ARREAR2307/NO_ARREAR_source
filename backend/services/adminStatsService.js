'use strict';

const User = require('../models/User');
const Department = require('../models/Department');
const Subject = require('../models/Subject');
const { ROLES } = require('../utils/roles');

// Why there is no course count. NO_ARREAR has no Course model, and the academic hierarchy
// (University -> Department -> Regulation -> Semester -> Subject) has no course level either:
//  - a student's `course` (for example "BCA" or "B.Sc.") is only free text typed at registration, and
//  - a Department is the programme/specialisation (for example "Computer Applications"), so one course label
//    can map to a department whose name differs, and the stored data has no course-to-department link.
// Counting distinct free-text values or reusing the department count would give a misleading number,
// so the endpoint reports the course total as unavailable instead of guessing.
const TOTAL_COURSES_UNAVAILABLE_REASON =
  'Courses are not stored in the academic data: there is no Course model, and a student\'s course is free text. ' +
  'A department is a programme, so its count would not be a course count.';

// Academic records are never deleted, only deactivated (isActive=false). Documents without the flag count as active,
// exactly like the student academic APIs (they only hide records whose isActive is false).
const ACTIVE = { isActive: { $ne: false } };

// Documents created before roles existed have no stored role; the model reads them as 'student'.
const STUDENT_FILTER = { $or: [{ role: ROLES.STUDENT }, { role: { $exists: false } }] };

/**
 * Live database counts for the admin dashboard.
 *  totalStudents    - student accounts only (admins are excluded)
 *  totalCourses     - null: cannot be derived accurately (see above)
 *  totalDepartments - active departments (UG and PG)
 *  totalSubjects    - active subjects
 */
const getAdminStats = async () => {
  const [totalStudents, totalDepartments, totalSubjects] = await Promise.all([
    User.countDocuments(STUDENT_FILTER),
    Department.countDocuments(ACTIVE),
    Subject.countDocuments(ACTIVE),
  ]);

  return {
    totalStudents,
    totalCourses: null,
    totalDepartments,
    totalSubjects,
    unavailable: { totalCourses: TOTAL_COURSES_UNAVAILABLE_REASON },
  };
};

module.exports = { getAdminStats, TOTAL_COURSES_UNAVAILABLE_REASON };
